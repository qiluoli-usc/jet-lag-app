import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.TASK3_PORT ?? 19080 + Math.floor(Math.random() * 1000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;
const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(method, path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${method} ${path}: ${data?.error?.message ?? text}`);
  }
  return data;
}

async function waitForHealth() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // wait server startup
    }
    await delay(100);
  }
  throw new Error("Server did not become healthy in time");
}

function parseWsMessage(raw) {
  if (typeof raw === "string") {
    return JSON.parse(raw);
  }
  if (raw instanceof ArrayBuffer) {
    return JSON.parse(Buffer.from(raw).toString("utf8"));
  }
  if (Buffer.isBuffer(raw)) {
    return JSON.parse(raw.toString("utf8"));
  }
  throw new Error(`Unsupported WS frame payload type: ${typeof raw}`);
}

function waitForWsOpen(socket, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket open timeout"));
    }, timeoutMs);
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (event) => {
      cleanup();
      reject(new Error(`WebSocket open failed: ${event?.message ?? "unknown"}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
  });
}

function waitForWsClose(socket, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket close timeout"));
    }, timeoutMs);
    const onClose = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("close", onClose);
    };
    socket.addEventListener("close", onClose);
  });
}

function waitForWsMessage(socket, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket message timeout"));
    }, timeoutMs);

    const onMessage = (event) => {
      let parsed;
      try {
        parsed = parseWsMessage(event.data);
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }
      if (!predicate(parsed)) {
        return;
      }
      cleanup();
      resolve(parsed);
    };

    const onError = (event) => {
      cleanup();
      reject(new Error(`WebSocket error: ${event?.message ?? "unknown"}`));
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
    };

    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
  });
}

async function main() {
  const server = spawn(process.execPath, ["src/server.js"], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });

  try {
    await waitForHealth();

    const created = await request("POST", "/rooms", {
      name: "task3-ws-room",
      rules: { hideDurationSec: 600, seekDurationSec: 120 },
    });
    const code = String(created?.code ?? "");
    assert(code.length > 0, "Create room should return code");

    const hider = await request("POST", `/rooms/${encodeURIComponent(code)}/join`, {
      name: "A",
      role: "hider",
    });
    const seeker = await request("POST", `/rooms/${encodeURIComponent(code)}/join`, {
      name: "B",
      role: "seeker",
    });
    assert(hider?.player?.id, "Hider join should return player ID");
    assert(seeker?.player?.id, "Seeker join should return player ID");

    const wsA = new WebSocket(WS_URL);
    const wsB = new WebSocket(WS_URL);
    await Promise.all([waitForWsOpen(wsA), waitForWsOpen(wsB)]);

    const snapshotAPromise = waitForWsMessage(wsA, (msg) => msg?.type === "SNAPSHOT");
    const snapshotBPromise = waitForWsMessage(wsB, (msg) => msg?.type === "SNAPSHOT");
    wsA.send(JSON.stringify({ type: "SUBSCRIBE", roomCode: code }));
    wsB.send(JSON.stringify({ type: "SUBSCRIBE", roomCode: code }));

    const [snapshotA, snapshotB] = await Promise.all([snapshotAPromise, snapshotBPromise]);

    assert(snapshotA?.roomCode === code, "A should receive room snapshot");
    assert(snapshotB?.roomCode === code, "B should receive room snapshot");
    const cursorBeforeReady = Number(snapshotB?.cursor);
    assert(Number.isInteger(cursorBeforeReady), "B snapshot cursor should be an integer");

    const bEventPromise = waitForWsMessage(
      wsB,
      (msg) => msg?.type === "EVENT_APPEND" && msg?.event?.type === "player.ready.updated",
      6000,
    );
    await request("POST", `/rooms/${encodeURIComponent(code)}/ready`, {
      playerId: hider.player.id,
      ready: true,
    });
    const bReadyEvent = await bEventPromise;

    const cursorAfterReady = Number(bReadyEvent?.cursor);
    assert(Number.isInteger(cursorAfterReady), "B EVENT_APPEND cursor should be integer");
    assert(
      cursorAfterReady >= cursorBeforeReady + 1,
      "B should receive a newer cursor after A marks ready",
    );

    wsB.close(1000, "reconnect");
    await waitForWsClose(wsB);

    await request("POST", `/rooms/${encodeURIComponent(code)}/ready`, {
      playerId: seeker.player.id,
      ready: true,
    });
    const afterDisconnectSnapshot = await request(
      "GET",
      `/rooms/${encodeURIComponent(code)}/snapshot?cursor=0&limit=200`,
    );
    const latestCursor = Number(afterDisconnectSnapshot?.cursor);
    assert(Number.isInteger(latestCursor), "HTTP snapshot cursor should be integer");
    assert(latestCursor > cursorAfterReady, "At least one new event should exist after disconnect");

    const wsBReconnect = new WebSocket(WS_URL);
    await waitForWsOpen(wsBReconnect);
    const replayBuffer = [];
    const onReplayMessage = (event) => {
      try {
        const parsed = parseWsMessage(event.data);
        if (parsed?.type === "EVENT_APPEND") {
          replayBuffer.push(parsed);
        }
      } catch {
        // ignore malformed replay frames in test harness
      }
    };
    wsBReconnect.addEventListener("message", onReplayMessage);
    const reconnectSnapshotPromise = waitForWsMessage(
      wsBReconnect,
      (msg) => msg?.type === "SNAPSHOT",
    );
    wsBReconnect.send(
      JSON.stringify({
        type: "SUBSCRIBE",
        roomCode: code,
        sinceCursor: String(cursorAfterReady),
      }),
    );

    const reconnectSnapshot = await reconnectSnapshotPromise;
    assert(
      Number(reconnectSnapshot?.cursor) === cursorAfterReady,
      "Reconnect SNAPSHOT cursor should equal sinceCursor",
    );

    const expectedMissed = latestCursor - cursorAfterReady;
    const deadline = Date.now() + 6000;
    while (replayBuffer.length < expectedMissed && Date.now() < deadline) {
      await delay(50);
    }
    const recovered = replayBuffer.slice(0, expectedMissed);
    wsBReconnect.removeEventListener("message", onReplayMessage);

    assert(recovered.length === expectedMissed, "Reconnect should replay all missed events");
    assert(Number(recovered[0]?.cursor) === cursorAfterReady + 1, "First replayed cursor mismatch");
    assert(Number(recovered[recovered.length - 1]?.cursor) === latestCursor, "Last replayed cursor mismatch");

    wsA.close(1000, "done");
    wsBReconnect.close(1000, "done");

    console.log("TASK3_TEST_OK", {
      code,
      cursorBeforeReady,
      cursorAfterReady,
      latestCursor,
      replayed: recovered.length,
    });
  } finally {
    if (!server.killed) {
      server.kill();
    }
    await delay(100);
  }
}

main().catch((error) => {
  console.error("TASK3_TEST_FAIL", error?.message ?? String(error));
  process.exit(1);
});
