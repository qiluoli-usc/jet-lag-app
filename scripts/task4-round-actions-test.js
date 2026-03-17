import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.TASK4_PORT ?? 20080 + Math.floor(Math.random() * 1000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(method, path, body, expectedStatus = null) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (expectedStatus !== null) {
    assert(response.status === expectedStatus, `${method} ${path} expected ${expectedStatus}, got ${response.status}`);
    return data;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${method} ${path}: ${data?.error?.message ?? text}`);
  }
  return data;
}

async function waitForHealth() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const health = await fetch(`${BASE_URL}/health`);
      if (health.ok) {
        return;
      }
    } catch {
      // retry
    }
    await delay(100);
  }
  throw new Error("Server did not become healthy in time");
}

async function waitForPhase(code, expectedPhase, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const snap = await request("GET", `/rooms/${encodeURIComponent(code)}/snapshot?limit=50`);
    if (snap?.roomProjection?.phase === expectedPhase) {
      return snap;
    }
    await delay(200);
  }
  throw new Error(`Timeout waiting for phase ${expectedPhase}`);
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
      name: "task4-room",
      rules: {
        hideDurationSec: 0,
        seekDurationSec: 120,
        questionCooldownSec: 0,
        catchDistanceMeters: 100,
        catchHoldSeconds: 0,
        hiderClueUnlockAfterSec: 0,
      },
    });
    const code = String(created?.code ?? "");
    assert(code.length > 0, "create room should return code");

    const hiderJoin = await request("POST", `/rooms/${encodeURIComponent(code)}/join`, {
      name: "H",
      role: "hider",
    });
    const seekerJoin = await request("POST", `/rooms/${encodeURIComponent(code)}/join`, {
      name: "S",
      role: "seeker",
    });
    const hiderId = hiderJoin?.player?.id;
    const seekerId = seekerJoin?.player?.id;
    assert(hiderId && seekerId, "join should return hider and seeker ids");

    await request("POST", `/rooms/${encodeURIComponent(code)}/ready`, {
      playerId: hiderId,
      ready: true,
    });
    await request("POST", `/rooms/${encodeURIComponent(code)}/ready`, {
      playerId: seekerId,
      ready: true,
    });

    await waitForPhase(code, "SEEKING");

    const ask = await request("POST", `/rounds/${encodeURIComponent(code)}/ask`, {
      playerId: seekerId,
      category: "matching",
      prompt: "Are you nearby?",
    });
    const questionId = ask?.result?.id;
    assert(questionId, "ask should return question id");

    await request("POST", `/rounds/${encodeURIComponent(code)}/answer`, {
      playerId: hiderId,
      questionId,
      kind: "yes_no",
      value: "yes",
      autoVerified: true,
    });

    const draw = await request("POST", `/rounds/${encodeURIComponent(code)}/drawCard`, {
      playerId: hiderId,
      count: 1,
    });
    const hiderHand = Array.isArray(draw?.projection?.hand) ? draw.projection.hand : [];
    const curse = hiderHand.find((card) => card?.type === "curse");
    if (curse?.id) {
      await request("POST", `/rounds/${encodeURIComponent(code)}/castCurse`, {
        playerId: hiderId,
        cardId: curse.id,
        targetPlayerId: seekerId,
      });
    }

    await request("POST", `/rounds/${encodeURIComponent(code)}/rollDice`, {
      playerId: seekerId,
      sides: 6,
      count: 1,
      purpose: "task4_validation",
    });

    await request("POST", `/rooms/${encodeURIComponent(code)}/location`, {
      playerId: hiderId,
      lat: 31.23,
      lng: 121.47,
      accuracy: 8,
    });
    await request("POST", `/rooms/${encodeURIComponent(code)}/location`, {
      playerId: seekerId,
      lat: 31.23,
      lng: 121.47,
      accuracy: 8,
    });

    const seekerView = await request("GET", `/rooms/${encodeURIComponent(code)}?playerId=${encodeURIComponent(seekerId)}`);
    const seekerPlayers = Array.isArray(seekerView?.room?.players) ? seekerView.room.players : [];
    const visibleHider = seekerPlayers.find((player) => player?.id === hiderId);
    assert(
      Number.isFinite(Number(visibleHider?.location?.lat)) && Number.isFinite(Number(visibleHider?.location?.lng)),
      "seeker room view should include hider location once it has been reported",
    );

    const catchResult = await request("POST", `/rounds/${encodeURIComponent(code)}/claimCatch`, {
      playerId: seekerId,
      targetPlayerId: hiderId,
      method: "distance",
      visualConfirmed: true,
    });
    const claimId = catchResult?.result?.id;
    assert(claimId, "claimCatch should return a pending catch claim id");
    assert(catchResult?.projection?.phase === "CAUGHT", "claimCatch should move room into CAUGHT review state");

    const resolved = await request("POST", `/rooms/${encodeURIComponent(code)}/catch/${encodeURIComponent(claimId)}/respond`, {
      playerId: hiderId,
      result: "success",
    });
    assert(resolved?.result?.phase === "Summary" || resolved?.result?.phase === "SUMMARY", "resolved catch should drive room to SUMMARY");

    console.log("TASK4_TEST_OK", {
      code,
      phase: resolved?.result?.phase ?? catchResult?.projection?.phase,
      cursor: catchResult.cursor ?? null,
      usedCastCurse: Boolean(curse?.id),
    });
  } finally {
    if (!server.killed) {
      server.kill();
    }
    await delay(100);
  }
}

main().catch((error) => {
  console.error("TASK4_TEST_FAIL", error?.message ?? String(error));
  process.exit(1);
});
