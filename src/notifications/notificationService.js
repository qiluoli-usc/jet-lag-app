import db from "../db/db.js";
import { Role } from "../game/models.js";
import { getRoomByRef, onRoomEventAppended } from "../game/store.js";

const EXPO_PUSH_URL = process.env.EXPO_PUSH_URL ?? "https://exp.host/--/api/v2/push/send";
let detachRoomEventNotifications = null;

const upsertToken = db.prepare(`
  INSERT INTO push_tokens (player_id, token, platform, updated_at)
  VALUES (@playerId, @token, @platform, @updatedAt)
  ON CONFLICT(player_id, token) DO UPDATE SET
    updated_at = excluded.updated_at,
    platform = excluded.platform
`);

const selectTokensByPlayer = db.prepare(`
  SELECT token, platform 
  FROM push_tokens 
  WHERE player_id = ?
`);

/**
 * Save a push token for a player.
 */
export function savePushToken(playerId, token, platform = "unknown") {
  upsertToken.run({
    playerId,
    token,
    platform,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Retrieve all push tokens for a specific player.
 */
export function getTokensForPlayer(playerId) {
  return selectTokensByPlayer.all(playerId);
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function displayNameForPlayer(room, playerId) {
  if (!playerId) {
    return "A player";
  }

  const player = room.players.find((item) => item.id === playerId);
  return player?.name ?? playerId.slice(-6);
}

function playerIdsByRole(room, role) {
  return room.players
    .filter((item) => item.role === role)
    .map((item) => item.id);
}

function allActivePlayerIds(room) {
  return room.players
    .filter((item) => item.role !== Role.OBSERVER)
    .map((item) => item.id);
}

function humanizeQuestionCategory(category) {
  const normalized = String(category ?? "").trim();
  if (!normalized) {
    return "question";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function buildNotificationForEvent(room, event) {
  const actorName = displayNameForPlayer(room, event.actorId);

  switch (event.type) {
    case "phase.seek.started":
      return {
        playerIds: allActivePlayerIds(room),
        title: "Seek started",
        body: "The seek phase is now live.",
        data: { type: event.type, roomId: room.id },
      };
    case "phase.end_game.started":
      return {
        playerIds: allActivePlayerIds(room),
        title: "Endgame started",
        body: "Seekers have entered the hiding zone.",
        data: { type: event.type, roomId: room.id },
      };
    case "summary.generated": {
      const winner = String(event.data?.winner ?? "unknown");
      return {
        playerIds: room.players.map((item) => item.id),
        title: "Round complete",
        body: winner === "seekers" ? "Seekers won the round." : "Hider survived the round.",
        data: { type: event.type, roomId: room.id, winner },
      };
    }
    case "question.asked":
      return {
        playerIds: playerIdsByRole(room, Role.HIDER),
        title: "New question",
        body: `${actorName} asked a ${humanizeQuestionCategory(event.data?.category)} question.`,
        data: { type: event.type, roomId: room.id, questionId: event.data?.id ?? null },
      };
    case "question.answered":
      return {
        playerIds: playerIdsByRole(room, Role.SEEKER),
        title: "Question answered",
        body: `${actorName} submitted an answer.`,
        data: { type: event.type, roomId: room.id, questionId: event.data?.questionId ?? null },
      };
    case "clue.shared":
      return {
        playerIds: playerIdsByRole(room, Role.SEEKER),
        title: "New clue",
        body: `${actorName} shared a clue.`,
        data: { type: event.type, roomId: room.id, clueId: event.data?.id ?? null },
      };
    case "card.cast": {
      const targetPlayerId = String(event.data?.targetPlayerId ?? "").trim();
      if (!targetPlayerId) {
        return null;
      }
      return {
        playerIds: [targetPlayerId],
        title: "Curse applied",
        body: `${actorName} cast a card on you.`,
        data: { type: event.type, roomId: room.id, targetPlayerId },
      };
    }
    case "catch.claimed": {
      const hiderId = String(event.data?.hiderId ?? "").trim();
      if (!hiderId) {
        return null;
      }
      return {
        playerIds: [hiderId],
        title: "Catch claimed",
        body: `${actorName} claimed a catch and is waiting for resolution.`,
        data: { type: event.type, roomId: room.id, claimId: event.data?.id ?? null },
      };
    }
    case "catch.resolved":
      return {
        playerIds: allActivePlayerIds(room),
        title: "Catch resolved",
        body: String(event.data?.result ?? "") === "success"
          ? "The catch was confirmed."
          : "The catch failed and play continues.",
        data: { type: event.type, roomId: room.id, claimId: event.data?.claimId ?? null },
      };
    case "dispute.created":
      return {
        playerIds: room.players
          .map((item) => item.id)
          .filter((playerId) => playerId !== event.actorId),
        title: "Dispute opened",
        body: `${actorName} opened a dispute.`,
        data: { type: event.type, roomId: room.id, disputeId: event.data?.id ?? null },
      };
    default:
      return null;
  }
}

/**
 * Send a push notification to specific tokens via Expo Push Service.
 * @param {string[]} tokens 
 * @param {string} title 
 * @param {string} body 
 * @param {object} data
 */
async function sendExpoPush(tokens, title, body, data = {}) {
  const uniqueTokens = uniqueValues(tokens);
  if (uniqueTokens.length === 0) return;

  const messages = uniqueTokens.map((token) => ({
    to: token,
    sound: "default",
    title,
    body,
    data,
    channelId: "game-events",
  }));

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      console.warn("[NotificationService] Push delivery failed:", response.status, await response.text());
    }
  } catch (err) {
    console.error(`[NotificationService] Error sending push notification: ${err.message}`);
  }
}

/**
 * Send a push notification to a specific player.
 */
export async function sendPushToPlayer(playerId, title, body, data = {}) {
  const records = getTokensForPlayer(playerId);
  const tokens = records.map((r) => r.token);
  await sendExpoPush(tokens, title, body, data);
}

/**
 * Send a push notification to multiple players. (e.g. all in a room except one)
 */
export async function sendPushToPlayers(playerIds, title, body, data = {}) {
  const allTokens = [];
  for (const pid of uniqueValues(playerIds)) {
    const records = getTokensForPlayer(pid);
    allTokens.push(...records.map((r) => r.token));
  }
  await sendExpoPush(allTokens, title, body, data);
}

export function attachRoomEventNotifications() {
  if (detachRoomEventNotifications) {
    return detachRoomEventNotifications;
  }

  const unsubscribe = onRoomEventAppended((payload) => {
    const room = getRoomByRef(payload.roomId);
    if (!room) {
      return;
    }

    const notification = buildNotificationForEvent(room, payload.event);
    if (!notification) {
      return;
    }

    const playerIds = uniqueValues(notification.playerIds);
    if (playerIds.length === 0) {
      return;
    }

    void sendPushToPlayers(playerIds, notification.title, notification.body, notification.data);
  });

  detachRoomEventNotifications = () => {
    unsubscribe();
    detachRoomEventNotifications = null;
  };

  return detachRoomEventNotifications;
}
