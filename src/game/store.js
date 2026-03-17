import crypto from "node:crypto";
import { Role, Visibility } from "./models.js";
import {
  applyEventToProjection,
  replayEventProjection,
  validateEventPayload,
} from "../realtime/events.js";
import {
  saveRoom as dbSaveRoom,
  appendEvent as dbAppendEvent,
  listSavedRooms,
  loadRoomEvents as dbLoadRoomEvents,
} from "../db/roomRepository.js";

export const rooms = new Map();
const roomCodeToId = new Map();
const roomEventSubscribers = new Set();
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;

// ── Boot-time hydration from SQLite ────────────────────────────────
try {
  const savedRooms = listSavedRooms();
  for (const roomData of savedRooms) {
    const roomId = roomData.id;
    // Restore events from DB
    const events = dbLoadRoomEvents(roomId);
    roomData.events = events;
    roomData.eventProjection = null; // will be rebuilt

    rooms.set(roomId, roomData);
    if (roomData.code) {
      roomCodeToId.set(roomData.code.toUpperCase(), roomId);
    }
  }
  if (savedRooms.length > 0) {
    console.log(`[store] Hydrated ${savedRooms.length} room(s) from database`);
  }
} catch (err) {
  console.error("[store] Failed to hydrate rooms from database:", err.message);
}

export function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function nowMs() {
  return Date.now();
}

export function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function hash(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function assert(condition, message, status = 400) {
  if (!condition) {
    const error = new Error(message);
    error.status = status;
    throw error;
  }
}

const allowedVisibility = new Set([
  Visibility.PUBLIC,
  Visibility.HIDER,
  Visibility.SEEKERS,
  Visibility.OBSERVERS,
]);

function projectionSeed(roomId) {
  return {
    roomId,
    phase: "Lobby",
    paused: false,
    roundNumber: 0,
    pendingQuestionId: null,
    pendingCatchClaimId: null,
    summary: null,
    players: {},
    questions: {},
    disputes: {},
    evidence: {},
    messages: [],
    mapAnnotations: [],
    counters: { total: 0, byType: {} },
    updatedAt: null,
  };
}

function normalizeRoomRef(value) {
  return String(value ?? "").trim();
}

function normalizeRoomCode(value) {
  return normalizeRoomRef(value).toUpperCase();
}

function parseCursorInput(cursorInput, total, fallbackCursor) {
  const hasCursor =
    cursorInput !== undefined &&
    cursorInput !== null &&
    String(cursorInput).trim() !== "";

  if (!hasCursor) {
    return fallbackCursor;
  }

  const parsed = Number(cursorInput);
  assert(Number.isInteger(parsed), "cursor must be an integer", 400);
  assert(parsed >= 0, "cursor must be >= 0", 400);
  assert(parsed <= total, `cursor cannot exceed total events (${total})`, 400);
  return parsed;
}

function projectionAtCursor(room, cursor) {
  return replayEventProjection(room.events.slice(0, cursor), projectionSeed(room.id));
}

function eventVisibleToRole(event, viewerRole) {
  if (viewerRole === Role.OBSERVER) {
    return true;
  }
  if (event.visibility === Visibility.PUBLIC) {
    return true;
  }
  if (event.visibility === Visibility.HIDER) {
    return viewerRole === Role.HIDER;
  }
  if (event.visibility === Visibility.SEEKERS) {
    return viewerRole === Role.SEEKER;
  }
  return false;
}

function projectionAtCursorForRole(room, cursor, viewerRole) {
  const filtered = room.events
    .slice(0, cursor)
    .filter((event) => eventVisibleToRole(event, viewerRole));
  return replayEventProjection(filtered, projectionSeed(room.id));
}

function randomRoomCode() {
  let output = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    output += ROOM_CODE_ALPHABET[crypto.randomInt(0, ROOM_CODE_ALPHABET.length)];
  }
  return output;
}

function bindRoomCode(room) {
  const existing = normalizeRoomCode(room?.code);
  if (existing) {
    room.code = existing;
    roomCodeToId.set(existing, room.id);
    return existing;
  }

  for (let attempts = 0; attempts < 1000; attempts += 1) {
    const candidate = randomRoomCode();
    if (!roomCodeToId.has(candidate)) {
      room.code = candidate;
      roomCodeToId.set(candidate, room.id);
      return candidate;
    }
  }

  assert(false, "Failed to allocate a unique room code", 500);
}

export function resolveRoomId(roomRef) {
  const normalized = normalizeRoomRef(roomRef);
  if (!normalized) {
    return null;
  }

  if (rooms.has(normalized)) {
    return normalized;
  }

  const byCode = roomCodeToId.get(normalizeRoomCode(normalized));
  if (byCode && rooms.has(byCode)) {
    return byCode;
  }

  const expectedCode = normalizeRoomCode(normalized);
  for (const [roomId, room] of rooms.entries()) {
    if (normalizeRoomCode(room?.code) === expectedCode) {
      roomCodeToId.set(expectedCode, roomId);
      return roomId;
    }
  }

  return null;
}

export function getRoomByRef(roomRef) {
  const roomId = resolveRoomId(roomRef);
  if (!roomId) {
    return null;
  }
  return rooms.get(roomId) ?? null;
}

export function ensureRoomCode(roomRef) {
  const room = typeof roomRef === "object" && roomRef !== null ? roomRef : getRoomByRef(roomRef);
  assert(room, `Room not found: ${String(roomRef)}`, 404);
  return bindRoomCode(room);
}

export function onRoomEventAppended(listener) {
  assert(typeof listener === "function", "listener must be a function", 500);
  roomEventSubscribers.add(listener);
  return () => {
    roomEventSubscribers.delete(listener);
  };
}

function notifyRoomEventAppended(payload) {
  for (const listener of roomEventSubscribers) {
    try {
      listener(payload);
    } catch (error) {
      console.error("[store] room event subscriber error", error);
    }
  }
}

function buildEnvelope(room, details) {
  assert(typeof details?.type === "string" && details.type.length > 0, "Event type is required", 400);

  const payload = details.data ?? {};
  const validation = validateEventPayload(details.type, payload);
  if (!validation.ok) {
    const message = `Invalid event payload for ${details.type}: ${validation.errors.join("; ")}`;
    assert(false, message, 400);
  }

  const visibility = details.visibility ?? Visibility.PUBLIC;
  assert(allowedVisibility.has(visibility), `Invalid event visibility: ${String(visibility)}`, 400);

  const previousHash = room.events.length > 0 ? room.events[room.events.length - 1].hash : "GENESIS";
  const ts = nowIso();
  const envelope = {
    id: newId("evt"),
    roomId: room.id,
    ts,
    type: details.type,
    actorId: details.actorId ?? null,
    visibility,
    data: payload,
    previousHash,
  };
  envelope.hash = hash(
    `${room.id}|${previousHash}|${JSON.stringify(envelope.data)}|${envelope.ts}|${envelope.type}|${envelope.visibility}`,
  );
  return envelope;
}

export function appendRoomEvent(room, details) {
  bindRoomCode(room);
  const event = buildEnvelope(room, details);
  const seq = room.events.length;
  room.events.push(event);
  room.updatedAt = event.ts;

  const currentProjection = room.eventProjection ?? null;
  room.eventProjection = applyEventToProjection(currentProjection, event);

  const replayed = replayEventProjection(room.events, projectionSeed(room.id));
  room.eventProjection = replayed;

  // ── Write-through to SQLite ──────────────────────────────────
  try {
    dbSaveRoom(room);        // room must exist before FK reference
    dbAppendEvent(room.id, event, seq);
  } catch (err) {
    console.error("[store] DB write-through error:", err.message);
  }

  notifyRoomEventAppended({
    roomId: room.id,
    roomCode: room.code,
    event: deepCopy(event),
    cursor: String(room.events.length),
  });
  return event;
}

/**
 * Persist the current room state to SQLite (call after create or bulk changes).
 */
export function persistRoom(room) {
  try {
    bindRoomCode(room);
    dbSaveRoom(room);
  } catch (err) {
    console.error("[store] persistRoom error:", err.message);
  }
}

export function rebuildRoomProjection(room) {
  bindRoomCode(room);
  room.eventProjection = replayEventProjection(room.events, projectionSeed(room.id));
  return deepCopy(room.eventProjection);
}

export function getRoomSnapshot(roomRef, options = {}) {
  const room = getRoomByRef(roomRef);
  assert(room, `Room not found: ${String(roomRef)}`, 404);
  const roomCode = bindRoomCode(room);
  const viewerRole = Object.values(Role).includes(options?.viewerRole)
    ? options.viewerRole
    : null;

  const limit = Math.max(1, Math.min(200, Number(options?.limit ?? 50)));
  const total = room.events.length;
  const cursor = parseCursorInput(options?.cursor, total, Math.max(0, total - limit));

  const end = Math.min(total, cursor + limit);
  const lastEvents = room.events
    .slice(cursor, end)
    .filter((event) => eventVisibleToRole(event, viewerRole));
  const projection = projectionAtCursorForRole(room, end, viewerRole);

  return deepCopy({
    roomId: room.id,
    roomCode,
    roomProjection: projection,
    lastEvents,
    cursor: String(end),
  });
}

export function getRoomRealtimeSync(roomRef, sinceCursor = null, options = {}) {
  const room = getRoomByRef(roomRef);
  assert(room, `Room not found: ${String(roomRef)}`, 404);
  const roomCode = bindRoomCode(room);
  const total = room.events.length;
  const cursor = parseCursorInput(sinceCursor, total, total);
  const viewerRole = Object.values(Role).includes(options?.viewerRole)
    ? options.viewerRole
    : null;

  const projection = projectionAtCursorForRole(room, cursor, viewerRole);
  const catchUpEvents = room.events
    .slice(cursor)
    .map((event, index) => ({
      event,
      cursor: String(cursor + index + 1),
    }))
    .filter((item) => eventVisibleToRole(item.event, viewerRole))
    .map((item) => ({
      event: deepCopy(item.event),
      cursor: item.cursor,
    }));

  return {
    roomId: room.id,
    roomCode,
    projection: deepCopy(projection),
    cursor: String(cursor),
    catchUpEvents,
  };
}

export function getRoomCursor(roomRef) {
  const room = getRoomByRef(roomRef);
  assert(room, `Room not found: ${String(roomRef)}`, 404);
  const roomCode = bindRoomCode(room);
  return {
    roomId: room.id,
    roomCode,
    cursor: String(room.events.length),
  };
}
