import db from "./db.js";

// ── Prepared statements ────────────────────────────────────────────

const upsertRoom = db.prepare(`
  INSERT INTO rooms (id, code, name, config, state, created_at, updated_at)
  VALUES (@id, @code, @name, @config, @state, @createdAt, @updatedAt)
  ON CONFLICT(id) DO UPDATE SET
    code = excluded.code,
    name = excluded.name,
    config = excluded.config,
    state = excluded.state,
    updated_at = excluded.updated_at
`);

const selectRoomById = db.prepare(`
  SELECT id, code, name, config, state, created_at AS createdAt, updated_at AS updatedAt
  FROM rooms WHERE id = ?
`);

const selectRoomByCode = db.prepare(`
  SELECT id, code, name, config, state, created_at AS createdAt, updated_at AS updatedAt
  FROM rooms WHERE code = ?
`);

const selectAllRooms = db.prepare(`
  SELECT id, code, name, config, state, created_at AS createdAt, updated_at AS updatedAt
  FROM rooms ORDER BY created_at DESC
`);

const insertEvent = db.prepare(`
  INSERT INTO room_events (id, room_id, seq, type, actor_id, visibility, data, hash, previous_hash, ts)
  VALUES (@id, @roomId, @seq, @type, @actorId, @visibility, @data, @hash, @previousHash, @ts)
`);

const selectEventsByRoom = db.prepare(`
  SELECT id, room_id AS roomId, seq, type, actor_id AS actorId, visibility, data, hash, previous_hash AS previousHash, ts
  FROM room_events WHERE room_id = ? ORDER BY seq ASC
`);

const selectEventsCount = db.prepare(`
  SELECT COUNT(*) AS cnt FROM room_events WHERE room_id = ?
`);

const upsertPlayer = db.prepare(`
  INSERT INTO players (id, user_id, room_id, display_name, role, joined_at)
  VALUES (@id, @userId, @roomId, @displayName, @role, @joinedAt)
  ON CONFLICT(id) DO UPDATE SET
    display_name = excluded.display_name,
    role = excluded.role
`);

const selectPlayersByRoom = db.prepare(`
  SELECT id, user_id AS userId, room_id AS roomId, display_name AS displayName, role, joined_at AS joinedAt
  FROM players WHERE room_id = ?
`);

const deletePlayerFromRoom = db.prepare(`
  DELETE FROM players WHERE id = ? AND room_id = ?
`);

// ── Room persistence ───────────────────────────────────────────────

/**
 * Persist a room object to SQLite.
 * @param {object} room — the in-memory room object from store.js
 */
export function saveRoom(room) {
  // Extract serialisable config (rules + scale + deck template IDs etc.)
  const config = JSON.stringify({
    rules: room.rules ?? {},
    scale: room.scale ?? null,
    deckTemplateIds: (room.deck ?? []).map((c) => c.templateId),
  });

  // The full mutable state: we store the entire room minus events
  // (events go to their own table). This is a pragmatic approach
  // that avoids rewriting the state machine.
  const stateClone = { ...room };
  delete stateClone.events;           // events stored separately
  delete stateClone.eventProjection;  // rebuilt from events
  const state = JSON.stringify(stateClone);

  upsertRoom.run({
    id: room.id,
    code: room.code ?? "",
    name: room.name ?? "",
    config,
    state,
    createdAt: room.createdAt ?? new Date().toISOString(),
    updatedAt: room.updatedAt ?? new Date().toISOString(),
  });
}

/**
 * Load a single room row from SQLite (without events).
 * Returns null if not found.
 */
export function loadRoomRow(roomId) {
  const row = selectRoomById.get(roomId);
  if (!row) return null;
  return parseRoomRow(row);
}

export function loadRoomByCode(code) {
  const row = selectRoomByCode.get(code);
  if (!row) return null;
  return parseRoomRow(row);
}

/**
 * Load all saved rooms (latest first).
 */
export function listSavedRooms() {
  return selectAllRooms.all().map(parseRoomRow);
}

function parseRoomRow(row) {
  return {
    ...JSON.parse(row.state),
    id: row.id,
    code: row.code,
    name: row.name || JSON.parse(row.state).name,
    _config: JSON.parse(row.config),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── Event persistence ──────────────────────────────────────────────

/**
 * Append an event envelope to the room_events table.
 */
export function appendEvent(roomId, event, seq) {
  insertEvent.run({
    id: event.id,
    roomId,
    seq,
    type: event.type,
    actorId: event.actorId ?? null,
    visibility: event.visibility ?? "public",
    data: JSON.stringify(event.data ?? {}),
    hash: event.hash,
    previousHash: event.previousHash,
    ts: event.ts,
  });
}

/**
 * Load all events for a room, ordered by sequence.
 */
export function loadRoomEvents(roomId) {
  return selectEventsByRoom.all(roomId).map((row) => ({
    id: row.id,
    roomId: row.roomId,
    type: row.type,
    actorId: row.actorId,
    visibility: row.visibility,
    data: JSON.parse(row.data),
    hash: row.hash,
    previousHash: row.previousHash,
    ts: row.ts,
  }));
}

export function countRoomEvents(roomId) {
  return selectEventsCount.get(roomId)?.cnt ?? 0;
}

// ── Player persistence ─────────────────────────────────────────────

export function savePlayer(player, roomId) {
  upsertPlayer.run({
    id: player.id,
    userId: player.userId ?? null,
    roomId,
    displayName: player.name ?? player.displayName ?? "",
    role: player.role ?? "seeker",
    joinedAt: player.joinedAt ?? new Date().toISOString(),
  });
}

export function loadPlayersByRoom(roomId) {
  return selectPlayersByRoom.all(roomId);
}

export function removePlayer(playerId, roomId) {
  deletePlayerFromRoom.run(playerId, roomId);
}

// ── Batch transaction helper ───────────────────────────────────────

export const runInTransaction = db.transaction((fn) => fn());
