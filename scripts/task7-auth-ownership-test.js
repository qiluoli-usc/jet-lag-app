import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

const PORT = Number(process.env.SMOKE_PORT ?? 18080 + Math.floor(Math.random() * 1000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;
const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEST_DB_PATH = join(PROJECT_ROOT, "data", "test-auth-ownership.db");

mkdirSync(dirname(TEST_DB_PATH), { recursive: true });

try { unlinkSync(TEST_DB_PATH); } catch {}
try { unlinkSync(TEST_DB_PATH + "-wal"); } catch {}
try { unlinkSync(TEST_DB_PATH + "-shm"); } catch {}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed += 1;
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(message);
  }
  passed += 1;
  console.log(`  ✓ ${message}`);
}

async function request(method, path, body, headers = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  return { status: response.status, data };
}

function startServer() {
  return spawn(process.execPath, ["src/server.js"], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: TEST_DB_PATH },
    stdio: "ignore",
  });
}

async function waitForHealth() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // keep waiting
    }
    await delay(150);
  }
  throw new Error("Server did not become healthy");
}

async function waitForShutdown(server) {
  if (!server.killed) {
    server.kill();
  }
  await delay(300);
}

async function waitForWsMessage(payload) {
  if (typeof WebSocket !== "function") {
    throw new Error("Global WebSocket is not available in this Node runtime");
  }

  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // no-op
      }
      reject(new Error("WebSocket response timed out"));
    }, 4000);

    ws.onopen = () => {
      ws.send(JSON.stringify(payload));
    };

    ws.onmessage = (event) => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(String(event.data));
        resolve(parsed);
      } catch (error) {
        reject(error);
      } finally {
        try {
          ws.close();
        } catch {
          // no-op
        }
      }
    };

    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("WebSocket error"));
    };
  });
}

async function register(displayName, password) {
  return await request("POST", "/auth/register", {
    displayName,
    password,
  });
}

async function main() {
  console.log("\n═══ Task 7: Auth Ownership Test ═══\n");

  const server = startServer();
  try {
    await waitForHealth();

    const alice = await register("Alice", "alice-pass");
    const bob = await register("Bob", "bob-pass");
    assert(alice.status === 201, "Alice registration succeeds");
    assert(bob.status === 201, "Bob registration succeeds");

    const createRoomRes = await request("POST", "/rooms", { name: "ownership-room" });
    assert(createRoomRes.status === 201, "Room creation succeeds");
    const roomCode = String(createRoomRes.data.code ?? "");
    assert(roomCode.length > 0, "Room creation returns code");

    const joinAlice = await request(
      "POST",
      `/rooms/${roomCode}/join`,
      { name: "NotAlice", role: "hider" },
      { Authorization: `Bearer ${alice.data.token}` },
    );
    assert(joinAlice.status === 201, "Authenticated Alice can join");
    assert(joinAlice.data.player?.name === "Alice", "Server binds authenticated player name to token identity");
    const alicePlayerId = joinAlice.data.player.id;

    const joinBob = await request(
      "POST",
      `/rooms/${roomCode}/join`,
      { name: "NotBob", role: "seeker" },
      { Authorization: `Bearer ${bob.data.token}` },
    );
    assert(joinBob.status === 201, "Authenticated Bob can join");
    assert(joinBob.data.player?.name === "Bob", "Authenticated Bob also receives bound name");

    const viewNoAuth = await request("GET", `/rooms/${roomCode}?playerId=${alicePlayerId}`);
    assert(viewNoAuth.status === 401, "Bound player projection requires authentication");

    const viewWrongAuth = await request(
      "GET",
      `/rooms/${roomCode}?playerId=${alicePlayerId}`,
      undefined,
      { Authorization: `Bearer ${bob.data.token}` },
    );
    assert(viewWrongAuth.status === 403, "Different authenticated user cannot read bound player projection");

    const viewAlice = await request(
      "GET",
      `/rooms/${roomCode}?playerId=${alicePlayerId}`,
      undefined,
      { Authorization: `Bearer ${alice.data.token}` },
    );
    assert(viewAlice.status === 200, "Correct authenticated user can read own projection");

    const readyNoAuth = await request("POST", `/rooms/${roomCode}/ready`, {
      playerId: alicePlayerId,
      ready: true,
    });
    assert(readyNoAuth.status === 401, "Bound player action requires authentication");

    const readyWrongAuth = await request(
      "POST",
      `/rooms/${roomCode}/ready`,
      { playerId: alicePlayerId, ready: true },
      { Authorization: `Bearer ${bob.data.token}` },
    );
    assert(readyWrongAuth.status === 403, "Different authenticated user cannot act as bound player");

    const readyAlice = await request(
      "POST",
      `/rooms/${roomCode}/ready`,
      { playerId: alicePlayerId, ready: true },
      { Authorization: `Bearer ${alice.data.token}` },
    );
    assert(readyAlice.status === 200, "Correct authenticated user can act as bound player");

    const wsNoAuth = await waitForWsMessage({
      type: "SUBSCRIBE",
      roomCode,
      playerId: alicePlayerId,
      sinceCursor: "0",
    });
    assert(wsNoAuth.type === "ERROR" && wsNoAuth.status === 401, "WebSocket subscribe requires token for bound player");

    const wsWrongAuth = await waitForWsMessage({
      type: "SUBSCRIBE",
      roomCode,
      playerId: alicePlayerId,
      sinceCursor: "0",
      token: bob.data.token,
    });
    assert(wsWrongAuth.type === "ERROR" && wsWrongAuth.status === 403, "WebSocket rejects mismatched token");

    const wsAlice = await waitForWsMessage({
      type: "SUBSCRIBE",
      roomCode,
      playerId: alicePlayerId,
      sinceCursor: "0",
      token: alice.data.token,
    });
    assert(wsAlice.type === "SNAPSHOT", "WebSocket accepts matching token");

    console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══\n`);
  } finally {
    await waitForShutdown(server);
    try { unlinkSync(TEST_DB_PATH); } catch {}
    try { unlinkSync(TEST_DB_PATH + "-wal"); } catch {}
    try { unlinkSync(TEST_DB_PATH + "-shm"); } catch {}
  }
}

main().catch((error) => {
  console.error(`\nTEST_FAIL: ${error.message}`);
  process.exit(1);
});
