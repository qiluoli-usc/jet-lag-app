/**
 * Task 1.5 — Push Notifications test
 *
 * Verifies:
 *   1. Push token registration + validation
 *   2. Event-driven push delivery through the Expo push bridge
 */

import { createServer as createHttpServer } from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { unlinkSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const PORT = Number(process.env.SMOKE_PORT ?? 18080 + Math.floor(Math.random() * 1000));
const PUSH_PORT = PORT + 1000;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const FAKE_PUSH_URL = `http://127.0.0.1:${PUSH_PORT}/push`;
const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEST_DB_PATH = join(PROJECT_ROOT, "data", "test-push.db");

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
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: TEST_DB_PATH,
      EXPO_PUSH_URL: FAKE_PUSH_URL,
    },
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

async function startFakePushCollector() {
  const receivedMessages = [];

  const server = createHttpServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/push") {
      res.writeHead(404);
      res.end();
      return;
    }

    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (Array.isArray(payload)) {
          receivedMessages.push(...payload);
        } else {
          receivedMessages.push(payload);
        }
      } catch (error) {
        receivedMessages.push({ error: error.message });
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ status: "ok" }] }));
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PUSH_PORT, "127.0.0.1", resolve);
  });

  return {
    server,
    receivedMessages,
  };
}

async function waitForPush(receivedMessages, predicate) {
  for (let i = 0; i < 40; i += 1) {
    const matched = receivedMessages.find(predicate);
    if (matched) {
      return matched;
    }
    await delay(150);
  }
  throw new Error("Expected push message was not received");
}

async function main() {
  console.log("\n═══ Task 1.5: Push Notification Test ═══\n");

  const { server: fakePushServer, receivedMessages } = await startFakePushCollector();
  const apiServer = startServer();

  try {
    await waitForHealth();

    const createRoomRes = await request("POST", "/rooms", { name: "push-room" });
    assert(createRoomRes.status === 201, "Can create room for push test");
    const roomCode = String(createRoomRes.data.code ?? "");
    assert(roomCode.length > 0, "Push test room has code");

    const hider = await request("POST", `/rooms/${roomCode}/join`, {
      name: "Hider",
      role: "hider",
    });
    const seeker = await request("POST", `/rooms/${roomCode}/join`, {
      name: "Seeker",
      role: "seeker",
    });
    assert(hider.status === 201, "Hider joins push test room");
    assert(seeker.status === 201, "Seeker joins push test room");

    const hiderPlayerId = hider.data.player.id;
    const seekerPlayerId = seeker.data.player.id;

    const res1 = await request("POST", "/push/register", {
      roomCode,
      playerId: hiderPlayerId,
      token: "ExpoPushToken[hider-token-123]",
      platform: "android",
    });
    assert(res1.status === 200 && res1.data.ok === true, "Can register push token");

    const resFail = await request("POST", "/push/register", {
      roomCode,
      token: "ExpoPushToken[missing-player]",
    });
    assert(resFail.status === 400, "Fails without playerId");

    const res2 = await request("POST", "/push/register", {
      roomCode,
      playerId: hiderPlayerId,
      token: "ExpoPushToken[hider-token-123]",
      platform: "ios",
    });
    assert(res2.status === 200 && res2.data.ok === true, "Can upsert existing push token");

    await request("POST", `/rooms/${roomCode}/ready`, {
      playerId: hiderPlayerId,
      ready: true,
    });
    const readySeeker = await request("POST", `/rooms/${roomCode}/ready`, {
      playerId: seekerPlayerId,
      ready: true,
    });
    assert(readySeeker.status === 200, "Seeker ready succeeds");

    const advance = await request("POST", `/rooms/${roomCode}/dev/advancePhase`, {
      playerId: seekerPlayerId,
      steps: 1,
    });
    assert(advance.status === 200, "Can advance room into seek phase");

    const askQuestion = await request("POST", `/rounds/${roomCode}/ask`, {
      playerId: seekerPlayerId,
      category: "matching",
      prompt: "Where are you?",
    });
    assert(askQuestion.status === 200, "Question ask succeeds");

    const delivered = await waitForPush(
      receivedMessages,
      (message) =>
        message.to === "ExpoPushToken[hider-token-123]" &&
        message.title === "New question",
    );

    assert(delivered.body.includes("asked"), "Push payload contains a readable question notification");

    console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══\n`);
  } finally {
    if (!apiServer.killed) {
      apiServer.kill();
    }
    await delay(200);
    await new Promise((resolve) => fakePushServer.close(resolve));
    try { unlinkSync(TEST_DB_PATH); } catch {}
    try { unlinkSync(TEST_DB_PATH + "-wal"); } catch {}
    try { unlinkSync(TEST_DB_PATH + "-shm"); } catch {}
  }
}

main().catch((error) => {
  console.error(`\nTEST_FAIL: ${error.message}`);
  process.exit(1);
});
