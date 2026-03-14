import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.SMOKE_PORT ?? 18080 + Math.floor(Math.random() * 1000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
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
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // keep waiting until server is ready
    }
    await delay(100);
  }
  throw new Error("Server did not become healthy in time");
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
      name: "smoke-room",
      rules: {
        hideDurationSec: 600,
        seekDurationSec: 120,
      },
    });
    const code = String(created?.code ?? created?.room?.code ?? "");
    assert(code.length > 0, "create room must return room code");

    const hider = await request("POST", `/rooms/${encodeURIComponent(code)}/join`, {
      name: "H",
      role: "hider",
    });
    const seeker = await request("POST", `/rooms/${encodeURIComponent(code)}/join`, {
      name: "S",
      role: "seeker",
    });
    assert(hider?.player?.id, "hider join must return player id");
    assert(seeker?.player?.id, "seeker join must return player id");

    await request("POST", `/rooms/${encodeURIComponent(code)}/ready`, {
      playerId: hider.player.id,
      ready: true,
    });

    const startRound = await request("POST", `/rooms/${encodeURIComponent(code)}/startRound`, {
      playerId: hider.player.id,
    });
    assert(startRound?.state?.phase === "HIDING", "startRound should return phase HIDING");

    const snapshot = await request("GET", `/rooms/${encodeURIComponent(code)}/snapshot?limit=20`);
    assert(snapshot?.roomProjection?.phase === "HIDING", "snapshot roomProjection phase should be HIDING");
    assert(Array.isArray(snapshot?.lastEvents), "snapshot should include lastEvents array");
    assert(typeof snapshot?.cursor === "string", "snapshot should include cursor string");

    const questionDefs = await request("GET", "/defs/questions");
    const cardDefs = await request("GET", "/defs/cards");
    assert(Array.isArray(questionDefs?.defs) && questionDefs.defs.length > 0, "defs/questions should return defs");
    assert(Array.isArray(cardDefs?.defs) && cardDefs.defs.length > 0, "defs/cards should return defs");

    console.log("SMOKE_TEST_OK", {
      code,
      phase: snapshot.roomProjection.phase,
      cursor: snapshot.cursor,
      lastEvents: snapshot.lastEvents.length,
    });
  } finally {
    if (!server.killed) {
      server.kill();
    }
    await delay(80);
  }
}

main().catch((error) => {
  console.error("SMOKE_TEST_FAIL", error?.message ?? String(error));
  process.exit(1);
});
