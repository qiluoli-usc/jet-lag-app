import { getRoomByRef, rooms } from "../game/store.js";

function normalizeUserId(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function applyAuthenticatedJoinInput(input = {}, user = null) {
  const next = {
    ...(input ?? {}),
  };

  if (!user?.userId) {
    return next;
  }

  next.name = user.displayName;
  next.userId = user.userId;
  return next;
}

export function getRoomPlayer(roomRef, playerId) {
  const normalizedPlayerId = String(playerId ?? "").trim();
  if (!normalizedPlayerId) {
    return null;
  }

  if (roomRef) {
    const room = getRoomByRef(roomRef);
    if (!room) {
      return null;
    }
    return room.players.find((item) => item.id === normalizedPlayerId) ?? null;
  }

  for (const room of rooms.values()) {
    const player = room.players.find((item) => item.id === normalizedPlayerId);
    if (player) {
      return player;
    }
  }

  return null;
}

export function authorizePlayerIdentity(roomRef, playerId, user = null) {
  const player = getRoomPlayer(roomRef, playerId);
  if (!player) {
    return {
      ok: true,
      player: null,
    };
  }

  const boundUserId = normalizeUserId(player.userId);
  if (!boundUserId) {
    return {
      ok: true,
      player,
    };
  }

  const requestUserId = normalizeUserId(user?.userId);
  if (!requestUserId) {
    return {
      ok: false,
      status: 401,
      message: "Authentication required for this player",
      player,
    };
  }

  if (requestUserId !== boundUserId) {
    return {
      ok: false,
      status: 403,
      message: "Player belongs to a different authenticated user",
      player,
    };
  }

  return {
    ok: true,
    player,
  };
}
