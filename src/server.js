import { createServer } from "node:http";
import "./db/db.js";  // initialize database on startup
import { registerUser, loginUser } from "./auth/auth.js";
import { extractUser, requireAuth } from "./auth/authMiddleware.js";
import { applyAuthenticatedJoinInput, authorizePlayerIdentity, getRoomPlayer } from "./auth/playerIdentity.js";
import { readEvidenceBinary, storeEvidenceBinary } from "./evidence/storage.js";
import { attachRoomEventNotifications, savePushToken } from "./notifications/notificationService.js";
import { URL } from "node:url";
import {
  addMapAnnotation,
  castCard,
  claimCatch,
  chooseRewardCards,
  createDispute,
  createRoom,
  drawCards,
  executeRoundAction,
  getRoom,
  getRoomEvents,
  getRoomPlaceDetails,
  getEvidenceUploadRecord,
  initEvidenceUpload,
  importCustomTransitPack,
  joinRoom,
  leaveRoom,
  listAvailableTransitPacks,
  listRooms,
  manualStartRound,
  nextRound,
  pauseRound,
  postChatMessage,
  postClue,
  projectRoom,
  reverseRoomAdminLevels,
  resolveDispute,
  resolveCatch,
  resumeRound,
  rollDice,
  searchRoomPlaces,
  setReady,
  setTransitStatus,
  submitAnswer,
  submitQuestion,
  tick,
  updateLocation,
  voteDispute,
  completeEvidenceUpload,
  debugAdvancePhase,
  updateRoomConfig,
} from "./game/stateMachine.js";
import { RoundAction } from "./realtime/events.js";
import { ensureRoomCode, getRoomSnapshot, resolveRoomId } from "./game/store.js";
import { attachRealtimeWsServer } from "./realtime/wsServer.js";
import { badRequest, parseIntegerParam, parseJsonBody, sendJson } from "./utils/http.js";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = String(process.env.HOST ?? "0.0.0.0");
const DEV_PHASE_CONTROL_ENABLED =
  String(
    process.env.ENABLE_DEV_PHASE_CONTROL ??
    (process.env.NODE_ENV === "production" ? "0" : "1"),
  ).trim() === "1";
const QUESTION_DEFS_MOCK = Object.freeze([
  { key: "matching", label: "Matching", answerLimitSec: 300, reward: { draw: 3, keep: 1 } },
  { key: "measuring", label: "Measuring", answerLimitSec: 300, reward: { draw: 3, keep: 1 } },
  { key: "radar", label: "Radar", answerLimitSec: 300, reward: { draw: 2, keep: 1 } },
  { key: "thermometer", label: "Thermometer", answerLimitSec: 300, reward: { draw: 2, keep: 1 } },
  { key: "photo", label: "Photo", answerLimitSec: 600, reward: { draw: 1, keep: 1 } },
  { key: "tentacles", label: "Tentacles", answerLimitSec: 300, reward: { draw: 4, keep: 2 } },
]);

const CARD_DEFS_MOCK = Object.freeze([
  { templateId: "tb_plus_5", name: "Time Bonus +5m", type: "time_bonus_fixed" },
  { templateId: "tb_plus_10", name: "Time Bonus +10m", type: "time_bonus_fixed" },
  { templateId: "powerup_veto", name: "Veto", type: "powerup" },
  { templateId: "powerup_randomize", name: "Randomize", type: "powerup" },
  { templateId: "powerup_discard1_draw2", name: "Discard 1 Draw 2", type: "powerup" },
  { templateId: "powerup_expand_hand_1", name: "Expand Hand Size +1", type: "powerup" },
  { templateId: "curse_no_matching", name: "Curse: Silence Matching", type: "curse" },
  { templateId: "curse_map_circle_only", name: "Curse: Circle Only", type: "curse" },
]);

const ROUND_ACTION_SET = new Set([
  RoundAction.ASK,
  RoundAction.ANSWER,
  RoundAction.DRAW_CARD,
  RoundAction.CAST_CURSE,
  RoundAction.ROLL_DICE,
  RoundAction.CLAIM_CATCH,
]);

const EXPLICIT_CORS_ORIGINS = String(process.env.CORS_ALLOW_ORIGIN ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

function isPrivateNetworkHost(hostname) {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") {
    return true;
  }
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return true;
  }
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return true;
  }
  const matched172 = hostname.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (matched172) {
    const second = Number(matched172[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

function isMobileDebugOrigin(origin) {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    return isPrivateNetworkHost(parsed.hostname);
  } catch {
    return false;
  }
}

function resolveCorsOrigin(origin) {
  const normalizedOrigin = String(origin ?? "").trim();
  if (!normalizedOrigin) {
    return "*";
  }

  if (EXPLICIT_CORS_ORIGINS.length > 0) {
    if (EXPLICIT_CORS_ORIGINS.includes("*")) {
      return normalizedOrigin;
    }
    if (EXPLICIT_CORS_ORIGINS.includes(normalizedOrigin)) {
      return normalizedOrigin;
    }
    return "null";
  }

  if (isMobileDebugOrigin(normalizedOrigin)) {
    return normalizedOrigin;
  }
  return "*";
}

function applyCors(req, res) {
  const allowedOrigin = resolveCorsOrigin(req.headers.origin);
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-Upload-Filename");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");
}

function toApiPhase(phase) {
  switch (phase) {
    case "Hide":
      return "HIDING";
    case "Seek":
      return "SEEKING";
    case "EndGame":
      return "END_GAME";
    case "Caught":
      return "CAUGHT";
    case "Summary":
      return "SUMMARY";
    case "Lobby":
    default:
      return "LOBBY";
  }
}

function toApiProjection(projection) {
  if (!projection || typeof projection !== "object") {
    return projection;
  }
  return {
    ...projection,
    phase: toApiPhase(projection.phase),
  };
}

function extractScopedId(pathname, scope) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2 || parts[0] !== scope) {
    return null;
  }
  return decodeURIComponent(parts[1]);
}

function routeSuffix(pathname, scope) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length <= 2 || parts[0] !== scope) {
    return "";
  }
  return parts.slice(2).join("/");
}

function extractRoomId(pathname) {
  return extractScopedId(pathname, "rooms");
}

function extractRoundId(pathname) {
  return extractScopedId(pathname, "rounds");
}

function normalizePlayerId(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function ensurePlayerAccess(req, res, roomRef, playerId) {
  const result = authorizePlayerIdentity(roomRef, playerId, req.user);
  if (result.ok) {
    return true;
  }

  sendJson(res, result.status, {
    error: {
      status: result.status,
      message: result.message,
    },
  });
  return false;
}

function normalizePathname(pathname) {
  if (pathname === "/api") {
    return "/";
  }
  if (pathname.startsWith("/api/")) {
    return pathname.slice(4);
  }
  return pathname;
}

async function readRequestBuffer(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0);
}

async function handleRequest(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = normalizePathname(url.pathname);
  extractUser(req);

  // ── Auth routes (always public) ────────────────────────────────
  if (req.method === "POST" && pathname === "/auth/register") {
    const body = await parseJsonBody(req);
    const result = await registerUser(body);
    return sendJson(res, 201, result);
  }
  if (req.method === "POST" && pathname === "/auth/login") {
    const body = await parseJsonBody(req);
    const result = await loginUser(body);
    return sendJson(res, 200, result);
  }
  if (req.method === "POST" && pathname === "/push/register") {
    const body = await parseJsonBody(req);
    const playerId = normalizePlayerId(body.playerId);
    const { token, platform, roomCode } = body;
    if (!playerId || !token) {
      return sendJson(res, 400, { error: { message: "playerId and token are required" } });
    }
    if (!ensurePlayerAccess(req, res, roomCode ?? null, playerId)) {
      return;
    }
    if (roomCode && !getRoomPlayer(roomCode, playerId)) {
      return badRequest(res, 404, `Player not found: ${playerId}`);
    }
    savePushToken(playerId, token, platform);
    return sendJson(res, 200, { ok: true });
  }

  const uploadId = extractScopedId(pathname, "uploads");
  if (uploadId && req.method === "PUT") {
    const record = getEvidenceUploadRecord(uploadId);
    if (!record) {
      return badRequest(res, 404, `Evidence not found: ${uploadId}`);
    }
    if (record.evidence.status !== "pending_upload") {
      return badRequest(res, 400, "Evidence upload is not pending");
    }
    const expiresAtMs = Date.parse(String(record.evidence.expiresAt ?? ""));
    if (Number.isFinite(expiresAtMs) && expiresAtMs < Date.now()) {
      return badRequest(res, 410, "Evidence upload URL expired");
    }

    const payload = await readRequestBuffer(req);
    if (payload.byteLength === 0) {
      return badRequest(res, 400, "Upload body is empty");
    }

    const fileNameHeader = typeof req.headers["x-upload-filename"] === "string"
      ? decodeURIComponent(req.headers["x-upload-filename"])
      : null;
    const stored = await storeEvidenceBinary(record.evidence, payload, {
      mimeType: req.headers["content-type"],
      fileName: fileNameHeader ?? record.evidence.fileName ?? record.evidence.evidenceId,
    });
    return sendJson(res, 200, { upload: stored });
  }
  if (uploadId && req.method === "GET") {
    const record = getEvidenceUploadRecord(uploadId);
    if (!record) {
      return badRequest(res, 404, `Evidence not found: ${uploadId}`);
    }
    if (record.evidence.status !== "completed" || !record.evidence.storageKey) {
      return badRequest(res, 404, "Evidence file is not available yet");
    }

    const file = await readEvidenceBinary(record.evidence.storageKey);
    const mimeType = String(record.evidence.mimeType ?? "application/octet-stream");
    const fileName = String(record.evidence.fileName ?? `${record.evidence.evidenceId}`).replace(/["\r\n]+/g, "_");

    res.writeHead(200, {
      "Content-Type": mimeType,
      "Content-Length": file.buffer.byteLength,
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "no-store",
    });
    res.end(file.buffer);
    return;
  }

  // ── Optional auth enforcement ──────────────────────────────────
  if (!requireAuth(req, res)) {
    return;  // 401 already sent
  }

  if (req.method === "GET" && pathname === "/health") {
    return sendJson(res, 200, { ok: true, service: "jet-lag-app-prototype", now: new Date().toISOString() });
  }

  if (req.method === "GET" && pathname === "/") {
    return sendJson(res, 200, {
      service: "jet-lag-app-prototype",
      status: "running",
      docs: {
        health: "/health",
        rooms: "/rooms",
        roundActions: "/rounds/:id/{ask|answer|drawCard|castCurse|rollDice|claimCatch}",
        snapshot: "/rooms/:code/snapshot",
        devAdvancePhase: "/rooms/:code/dev/advancePhase",
        defsQuestions: "/defs/questions",
        defsCards: "/defs/cards",
        realtimeWs: "/ws",
        apiPrefix: "/api",
      },
    });
  }

  if (req.method === "GET" && pathname === "/defs/questions") {
    return sendJson(res, 200, {
      version: "mock-v1",
      defs: QUESTION_DEFS_MOCK,
    });
  }

  if (req.method === "GET" && pathname === "/defs/cards") {
    return sendJson(res, 200, {
      version: "mock-v1",
      defs: CARD_DEFS_MOCK,
    });
  }

  if (req.method === "GET" && pathname === "/transit/packs") {
    return sendJson(res, 200, {
      packs: listAvailableTransitPacks(),
    });
  }

  if (req.method === "POST" && pathname === "/transit/packs/import") {
    const body = await parseJsonBody(req);
    return sendJson(res, 201, {
      pack: importCustomTransitPack(body),
    });
  }

  if (req.method === "GET" && pathname === "/rooms") {
    return sendJson(res, 200, { rooms: listRooms() });
  }

  if (req.method === "POST" && pathname === "/rooms") {
    const body = await parseJsonBody(req);
    const room = createRoom(body);
    const code = ensureRoomCode(room.id);
    return sendJson(res, 201, { room: { ...room, code }, code });
  }

  const roundId = extractRoundId(pathname);
  if (roundId) {
    const action = routeSuffix(pathname, "rounds");
    if (req.method !== "POST" || !ROUND_ACTION_SET.has(action)) {
      return badRequest(res, 404, "Route not found");
    }

    const roomId = resolveRoomId(roundId);
    if (!roomId) {
      return badRequest(res, 404, `Room not found: ${roundId}`);
    }

    const body = await parseJsonBody(req);
    const actorPlayerId = normalizePlayerId(body.playerId);
    if (actorPlayerId && !ensurePlayerAccess(req, res, roomId, actorPlayerId)) {
      return;
    }
    const actionResult = executeRoundAction(roomId, action, body);
    return sendJson(res, 200, {
      ...actionResult,
      projection: toApiProjection(actionResult.projection),
    });
  }

  const roomCode = extractRoomId(pathname);
  if (!roomCode) {
    return badRequest(res, 404, "Route not found");
  }

  if (req.method === "GET" && pathname === `/rooms/${roomCode}/snapshot`) {
    const viewerPlayerId = normalizePlayerId(url.searchParams.get("playerId"));
    if (viewerPlayerId && !ensurePlayerAccess(req, res, roomCode, viewerPlayerId)) {
      return;
    }
    const viewerPlayer = viewerPlayerId ? getRoomPlayer(roomCode, viewerPlayerId) : null;
    if (viewerPlayerId && !viewerPlayer) {
      return badRequest(res, 404, `Player not found: ${viewerPlayerId}`);
    }
    const cursor = parseIntegerParam(url.searchParams.get("cursor"), {
      name: "cursor",
      min: 0,
      fallback: null,
    });
    const limit = parseIntegerParam(url.searchParams.get("limit"), {
      name: "limit",
      min: 1,
      max: 200,
      fallback: 50,
    });
    const viewerRole = viewerPlayer?.role ?? null;
    const snapshot = getRoomSnapshot(roomCode, { cursor, limit, viewerRole });
    return sendJson(res, 200, {
      roomProjection: {
        ...snapshot.roomProjection,
        phase: toApiPhase(snapshot.roomProjection?.phase),
      },
      lastEvents: snapshot.lastEvents,
      cursor: snapshot.cursor,
      roomId: snapshot.roomId,
      code: snapshot.roomCode,
    });
  }

  const roomId = resolveRoomId(roomCode);
  if (!roomId) {
    return badRequest(res, 404, `Room not found: ${roomCode}`);
  }

  const suffix = routeSuffix(pathname, "rooms");

  if (req.method === "GET" && suffix === "") {
    const playerId = normalizePlayerId(url.searchParams.get("playerId"));
    if (!playerId) {
      return badRequest(res, 400, "playerId query is required");
    }
    if (!ensurePlayerAccess(req, res, roomId, playerId)) {
      return;
    }
    const projected = projectRoom(roomId, playerId);
    return sendJson(res, 200, { room: projected });
  }

  let body = req.method === "POST" ? await parseJsonBody(req) : {};
  const actorPlayerId = normalizePlayerId(body.playerId);
  if (actorPlayerId && !ensurePlayerAccess(req, res, roomId, actorPlayerId)) {
    return;
  }
  if (req.user && req.method === "POST" && suffix === "join") {
    body = applyAuthenticatedJoinInput(body, req.user);
  }

  if (req.method === "POST" && suffix === "join") {
    return sendJson(res, 201, { player: joinRoom(roomId, body) });
  }
  if (req.method === "POST" && suffix === "leave") {
    return sendJson(res, 200, { left: leaveRoom(roomId, body) });
  }
  if (req.method === "POST" && suffix === "ready") {
    const state = setReady(roomId, body);
    return sendJson(res, 200, { state: { ...state, phase: toApiPhase(state.phase) } });
  }
  if (req.method === "POST" && suffix === "startRound") {
    const state = manualStartRound(roomId, body);
    return sendJson(res, 200, { state: { ...state, phase: toApiPhase(state.phase) } });
  }
  if (req.method === "POST" && suffix === "config") {
    return sendJson(res, 200, { room: updateRoomConfig(roomId, body) });
  }
  if (req.method === "POST" && suffix === "dev/advancePhase") {
    if (!DEV_PHASE_CONTROL_ENABLED) {
      return badRequest(res, 403, "Dev phase controls are disabled (set ENABLE_DEV_PHASE_CONTROL=1)");
    }
    const state = debugAdvancePhase(roomId, body);
    return sendJson(res, 200, { state: { ...state, phase: toApiPhase(state.phase) } });
  }
  if (req.method === "POST" && suffix === "start") {
    return sendJson(res, 200, { state: manualStartRound(roomId, body) });
  }
  if (req.method === "POST" && suffix === "location") {
    return sendJson(res, 200, { location: updateLocation(roomId, body) });
  }
  if (req.method === "POST" && suffix === "transit") {
    return sendJson(res, 200, { transit: setTransitStatus(roomId, body) });
  }
  if (req.method === "POST" && suffix === "questions") {
    return sendJson(res, 201, { question: submitQuestion(roomId, body) });
  }
  if (req.method === "POST" && suffix === "questions/ask") {
    return sendJson(res, 201, { question: submitQuestion(roomId, body) });
  }
  {
    const answerMatch = req.method === "POST"
      ? suffix.match(/^questions\/([^/]+)\/answer$/)
      : null;
    if (answerMatch) {
      return sendJson(res, 201, {
        answer: submitAnswer(roomId, {
          ...body,
          questionId: decodeURIComponent(answerMatch[1]),
        }),
      });
    }
  }
  if (req.method === "POST" && suffix === "answers") {
    return sendJson(res, 201, { answer: submitAnswer(roomId, body) });
  }
  if (req.method === "POST" && suffix === "rewards/choose") {
    return sendJson(res, 200, { reward: chooseRewardCards(roomId, body) });
  }
  if (req.method === "POST" && suffix === "map-annotations") {
    return sendJson(res, 201, { annotation: addMapAnnotation(roomId, body) });
  }
  if (req.method === "POST" && suffix === "cards/draw") {
    return sendJson(res, 200, { cards: drawCards(roomId, body) });
  }
  if (req.method === "POST" && suffix === "cards/cast") {
    return sendJson(res, 200, { effect: castCard(roomId, body) });
  }
  if (req.method === "POST" && suffix === "cards/play") {
    return sendJson(res, 200, { effect: castCard(roomId, body) });
  }
  if (req.method === "POST" && suffix === "dice/roll") {
    return sendJson(res, 200, { roll: rollDice(roomId, body) });
  }
  if (req.method === "POST" && suffix === "clues") {
    return sendJson(res, 201, { clue: postClue(roomId, body) });
  }
  if (req.method === "POST" && suffix === "messages") {
    return sendJson(res, 201, { message: postChatMessage(roomId, body) });
  }
  if (req.method === "POST" && suffix === "pause") {
    return sendJson(res, 200, { pause: pauseRound(roomId, body) });
  }
  if (req.method === "POST" && suffix === "resume") {
    return sendJson(res, 200, { pause: resumeRound(roomId, body) });
  }
  if (req.method === "POST" && suffix === "disputes") {
    return sendJson(res, 201, { dispute: createDispute(roomId, body) });
  }
  {
    const voteMatch = req.method === "POST"
      ? suffix.match(/^disputes\/([^/]+)\/vote$/)
      : null;
    if (voteMatch) {
      return sendJson(res, 200, {
        dispute: voteDispute(roomId, {
          ...body,
          disputeId: decodeURIComponent(voteMatch[1]),
        }),
      });
    }
  }
  if (req.method === "POST" && suffix === "disputes/resolve") {
    return sendJson(res, 200, { dispute: resolveDispute(roomId, body) });
  }
  if (req.method === "POST" && suffix === "catch-claims") {
    return sendJson(res, 200, { claim: claimCatch(roomId, body) });
  }
  if (req.method === "POST" && suffix === "catch/claim") {
    return sendJson(res, 200, { claim: claimCatch(roomId, body) });
  }
  {
    const respondMatch = req.method === "POST"
      ? suffix.match(/^catch\/([^/]+)\/respond$/)
      : null;
    if (respondMatch) {
      return sendJson(res, 200, {
        result: resolveCatch(roomId, {
          ...body,
          claimId: decodeURIComponent(respondMatch[1]),
        }),
      });
    }
  }
  if (req.method === "POST" && suffix === "catch-resolve") {
    return sendJson(res, 200, { result: resolveCatch(roomId, body) });
  }
  if (req.method === "POST" && suffix === "places/search") {
    return sendJson(res, 200, { places: await searchRoomPlaces(roomId, body) });
  }
  if (req.method === "POST" && suffix === "places/details") {
    return sendJson(res, 200, { place: await getRoomPlaceDetails(roomId, body) });
  }
  if (req.method === "POST" && suffix === "admin-levels/reverse") {
    return sendJson(res, 200, { admin: await reverseRoomAdminLevels(roomId, body) });
  }
  if (req.method === "POST" && suffix === "evidence/upload-init") {
    return sendJson(res, 200, { upload: initEvidenceUpload(roomId, body) });
  }
  if (req.method === "POST" && suffix === "evidence/complete") {
    return sendJson(res, 200, { evidence: completeEvidenceUpload(roomId, body) });
  }
  if (req.method === "GET" && suffix === "events") {
    const viewerPlayerId = normalizePlayerId(url.searchParams.get("playerId"));
    if (viewerPlayerId && !ensurePlayerAccess(req, res, roomId, viewerPlayerId)) {
      return;
    }
    return sendJson(res, 200, {
      events: getRoomEvents(roomId, {
        playerId: viewerPlayerId,
        sinceMs: url.searchParams.get("since"),
        limit: url.searchParams.get("limit"),
      }),
    });
  }
  if (req.method === "POST" && suffix === "next-round") {
    return sendJson(res, 200, { state: nextRound(roomId, body) });
  }
  if (req.method === "GET" && suffix === "raw") {
    if (!DEV_PHASE_CONTROL_ENABLED) {
      return badRequest(res, 403, "Raw room access is disabled outside development");
    }
    return sendJson(res, 200, { room: getRoom(roomId) });
  }

  return badRequest(res, 404, "Route not found");
}

const server = createServer(async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    await handleRequest(req, res);
  } catch (error) {
    const status = Number(error?.status ?? 400);
    return badRequest(res, status, error?.message ?? "Unknown error");
  }
});
attachRealtimeWsServer(server);
attachRoomEventNotifications();

server.listen(PORT, HOST, () => {
  console.log(`Jet Lag App Prototype API listening on http://${HOST}:${PORT}`);
  if (HOST === "0.0.0.0") {
    console.log(`Local debug mirror: http://localhost:${PORT}`);
  }
});

setInterval(() => {
  tick(Date.now());
}, 1000).unref();
