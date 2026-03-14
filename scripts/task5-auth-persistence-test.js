/**
 * Task 5 — Auth + Persistence regression test
 *
 * Tests:
 *   1. Register a new user → expect token
 *   2. Duplicate registration → expect 409
 *   3. Login → expect token
 *   4. Login with wrong password → expect 401
 *   5. Create room (anonymous) → expect success
 *   6. Register, then create room with token → expect success
 *   7. Restart server → verify rooms survive (persistence test)
 */

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const PORT = Number(process.env.SMOKE_PORT ?? 18080 + Math.floor(Math.random() * 1000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEST_DB_PATH = join(PROJECT_ROOT, "data", "test-auth.db");

// Ensure data dir exists
mkdirSync(dirname(TEST_DB_PATH), { recursive: true });

// Clean test db before run
try { unlinkSync(TEST_DB_PATH); } catch {}
try { unlinkSync(TEST_DB_PATH + "-wal"); } catch {}
try { unlinkSync(TEST_DB_PATH + "-shm"); } catch {}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(message);
  }
  passed++;
  console.log(`  ✓ ${message}`);
}

async function request(method, path, body, headers = {}) {
  const opts = {
    method,
    headers: { ...headers },
  };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE_URL}${path}`, opts);
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
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {}
    await delay(150);
  }
  throw new Error("Server did not become healthy");
}

async function waitForShutdown(server) {
  if (!server.killed) server.kill();
  await delay(500);
}

async function main() {
  console.log("\n═══ Task 5: Auth + Persistence Test ═══\n");

  // ── Phase 1: Auth tests ──────────────────────────────────────────
  console.log("Phase 1 ─ Auth");

  let server = startServer();
  try {
    await waitForHealth();

    // 1. Register
    const reg = await request("POST", "/auth/register", {
      displayName: "TestHider",
      password: "pass1234",
    });
    assert(reg.status === 201, `Register returns 201 (got ${reg.status})`);
    assert(typeof reg.data.token === "string" && reg.data.token.length > 10, "Register returns a JWT token");
    assert(reg.data.user?.id?.startsWith("usr_"), "Register returns user with id");
    assert(reg.data.user?.displayName === "TestHider", "Register returns correct displayName");
    const token1 = reg.data.token;

    // 2. Duplicate registration
    const dup = await request("POST", "/auth/register", {
      displayName: "TestHider",
      password: "other",
    });
    assert(dup.status === 409, `Duplicate register returns 409 (got ${dup.status})`);

    // 3. Login
    const login = await request("POST", "/auth/login", {
      displayName: "TestHider",
      password: "pass1234",
    });
    assert(login.status === 200, `Login returns 200 (got ${login.status})`);
    assert(typeof login.data.token === "string", "Login returns a JWT token");

    // 4. Wrong password
    const badLogin = await request("POST", "/auth/login", {
      displayName: "TestHider",
      password: "wrong",
    });
    assert(badLogin.status === 401, `Wrong password returns 401 (got ${badLogin.status})`);

    // 5. Create room (anonymous — no token)
    const roomAnon = await request("POST", "/rooms", { name: "anon-room" });
    assert(roomAnon.status === 201, `Anonymous room creation returns 201 (got ${roomAnon.status})`);
    const code1 = roomAnon.data.code;
    assert(typeof code1 === "string" && code1.length > 0, "Room has a code");

    // 6. Create room with auth header
    const roomAuth = await request("POST", "/rooms", { name: "auth-room" }, {
      Authorization: `Bearer ${token1}`,
    });
    assert(roomAuth.status === 201, `Authenticated room creation returns 201 (got ${roomAuth.status})`);
    const code2 = roomAuth.data.code;

    // Join a player and add some events
    const hider = await request("POST", `/rooms/${code1}/join`, { name: "H", role: "hider" });
    assert(hider.status === 201, "Hider joins room");
    const seeker = await request("POST", `/rooms/${code1}/join`, { name: "S", role: "seeker" });
    assert(seeker.status === 201, "Seeker joins room");

    // Ready up and start
    await request("POST", `/rooms/${code1}/ready`, { playerId: hider.data.player.id, ready: true });
    const startResult = await request("POST", `/rooms/${code1}/startRound`, { playerId: hider.data.player.id });

    console.log("\nPhase 2 ─ Persistence (restart server)");

    // ── Phase 2: Persistence test ──────────────────────────────────
    await waitForShutdown(server);
    assert(existsSync(TEST_DB_PATH), "Database file exists after server stop");

    // Restart
    server = startServer();
    await waitForHealth();

    // Verify rooms survived
    const roomsList = await request("GET", "/rooms");
    assert(roomsList.status === 200, "GET /rooms succeeds after restart");
    assert(
      Array.isArray(roomsList.data.rooms) && roomsList.data.rooms.length >= 2,
      `Rooms survived restart (found ${roomsList.data.rooms?.length ?? 0} rooms, expected >= 2)`,
    );

    const restoredRoom = roomsList.data.rooms.find((r) => r.id === roomAnon.data.room?.id || r.name === "anon-room");
    if (restoredRoom) {
      assert(restoredRoom.players >= 2, `Room has ${restoredRoom.players} players (expected >= 2)`);
    }

    // Verify user login still works (DB persisted)
    const loginAfterRestart = await request("POST", "/auth/login", {
      displayName: "TestHider",
      password: "pass1234",
    });
    assert(loginAfterRestart.status === 200, "Login works after server restart");

    console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══\n`);
  } finally {
    await waitForShutdown(server);
    // Cleanup test DB
    try { unlinkSync(TEST_DB_PATH); } catch {}
    try { unlinkSync(TEST_DB_PATH + "-wal"); } catch {}
    try { unlinkSync(TEST_DB_PATH + "-shm"); } catch {}
  }
}

main().catch((err) => {
  console.error(`\nTEST_FAIL: ${err.message}`);
  process.exit(1);
});
