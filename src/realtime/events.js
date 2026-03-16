export const EventVisibility = Object.freeze({
  PUBLIC: "public",
  TEAM: "team",
  PRIVATE: "private",
});

export const WsEvent = Object.freeze({
  ROOM_STATE_UPDATED: "ROOM_STATE_UPDATED",
  PLAYER_LOCATION_UPDATED: "PLAYER_LOCATION_UPDATED",
  QUESTION_ASKED: "QUESTION_ASKED",
  QUESTION_ANSWERED: "QUESTION_ANSWERED",
  QUESTION_VETOED: "QUESTION_VETOED",
  CARD_DRAWN: "CARD_DRAWN",
  CARD_PLAYED: "CARD_PLAYED",
  CURSE_APPLIED: "CURSE_APPLIED",
  CURSE_RESOLVED: "CURSE_RESOLVED",
  DICE_ROLLED: "DICE_ROLLED",
  CATCH_CLAIMED: "CATCH_CLAIMED",
  CATCH_RESULT: "CATCH_RESULT",
  DISPUTE_OPENED: "DISPUTE_OPENED",
  DISPUTE_RESOLVED: "DISPUTE_RESOLVED",
  SUMMARY_READY: "SUMMARY_READY",
});

export const RoundAction = Object.freeze({
  ASK: "ask",
  ANSWER: "answer",
  DRAW_CARD: "drawCard",
  CAST_CURSE: "castCurse",
  ROLL_DICE: "rollDice",
  CLAIM_CATCH: "claimCatch",
});

export const ROUND_ACTION_CAPABILITY = Object.freeze({
  [RoundAction.ASK]: "canAskQuestion",
  [RoundAction.ANSWER]: "canAnswerQuestion",
  [RoundAction.DRAW_CARD]: "canDrawCard",
  [RoundAction.CAST_CURSE]: "canCastCard",
  [RoundAction.ROLL_DICE]: "canRollDice",
  [RoundAction.CLAIM_CATCH]: "canClaimCatch",
});

export const ROUND_ACTION_PRIMARY_EVENT = Object.freeze({
  [RoundAction.ASK]: "question.asked",
  [RoundAction.ANSWER]: "question.answered",
  [RoundAction.DRAW_CARD]: "card.drawn",
  [RoundAction.CAST_CURSE]: "card.cast",
  [RoundAction.ROLL_DICE]: "dice.rolled",
  [RoundAction.CLAIM_CATCH]: "catch.claimed",
});

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schema(required = [], types = {}) {
  return Object.freeze({
    required: [...required],
    types: { ...types },
  });
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function checkType(expected, value) {
  if (Array.isArray(expected)) {
    return expected.some((entry) => checkType(entry, value));
  }
  if (expected === "array") {
    return Array.isArray(value);
  }
  if (expected === "object") {
    return isPlainObject(value);
  }
  if (expected === "null") {
    return value === null;
  }
  if (expected === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  return typeof value === expected;
}

export function validatePayloadSchema(payloadSchema, payload) {
  const errors = [];
  if (!isPlainObject(payload)) {
    return {
      ok: false,
      errors: ["Payload must be an object"],
    };
  }

  for (const field of payloadSchema.required) {
    if (!(field in payload) || payload[field] === undefined) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  for (const [field, expectedType] of Object.entries(payloadSchema.types)) {
    if (!(field in payload) || payload[field] === undefined || payload[field] === null) {
      continue;
    }
    if (!checkType(expectedType, payload[field])) {
      const expected = Array.isArray(expectedType) ? expectedType.join("|") : expectedType;
      errors.push(`Invalid field type: ${field} (expected ${expected})`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function createProjection(roomId = null) {
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
    mapAnnotations: [],
    counters: {
      total: 0,
      byType: {},
    },
    updatedAt: null,
  };
}

function ensurePlayerProjection(state, playerId) {
  if (!playerId) {
    return null;
  }
  if (!state.players[playerId]) {
    state.players[playerId] = {
      playerId,
      ready: false,
      inTransit: false,
      lastLocationTs: null,
      location: null,
    };
  }
  return state.players[playerId];
}

function baseApply(state, event) {
  state.counters.total += 1;
  state.counters.byType[event.type] = (state.counters.byType[event.type] ?? 0) + 1;
  state.updatedAt = event.ts ?? null;
}

function def(type, visibility, payloadSchema, apply, wsEvent = WsEvent.ROOM_STATE_UPDATED) {
  return Object.freeze({
    type,
    visibility,
    payloadSchema,
    apply,
    wsEvent,
  });
}

const PROTOCOL = Object.freeze({
  "room.created": def(
    "room.created",
    EventVisibility.PUBLIC,
    schema(["roomId"], { roomId: "string", mode: "string", scale: "string", mapProvider: "string" }),
    (state, event) => {
      state.roomId = event.data.roomId ?? state.roomId;
      state.phase = "Lobby";
    },
  ),
  "player.joined": def(
    "player.joined",
    EventVisibility.PUBLIC,
    schema(["name", "role"], { name: "string", role: "string" }),
    (state, event) => {
      const player = ensurePlayerProjection(state, event.actorId);
      if (player) {
        player.name = event.data.name;
        player.role = event.data.role;
      }
    },
    WsEvent.ROOM_STATE_UPDATED,
  ),
  "player.ready.updated": def(
    "player.ready.updated",
    EventVisibility.PUBLIC,
    schema(["ready"], { ready: "boolean" }),
    (state, event) => {
      const player = ensurePlayerProjection(state, event.actorId);
      if (player) {
        player.ready = event.data.ready;
      }
    },
    WsEvent.ROOM_STATE_UPDATED,
  ),
  "player.left": def(
    "player.left",
    EventVisibility.PUBLIC,
    schema(["playerId"], { playerId: "string", name: ["string", "null"], role: ["string", "null"] }),
    (state, event) => {
      const playerId = String(event.data.playerId ?? event.actorId ?? "").trim();
      if (!playerId) {
        return;
      }
      if (state.players[playerId]) {
        delete state.players[playerId];
      }
      if (state.pendingQuestionId) {
        const pending = state.questions[state.pendingQuestionId];
        if (pending?.playerId === playerId) {
          state.pendingQuestionId = null;
        }
      }
    },
    WsEvent.ROOM_STATE_UPDATED,
  ),
  "player.transit.updated": def(
    "player.transit.updated",
    EventVisibility.PUBLIC,
    schema(["inTransit"], { inTransit: "boolean", nearestStopId: ["string", "null"], transitLines: "array" }),
    (state, event) => {
      const player = ensurePlayerProjection(state, event.actorId);
      if (player) {
        player.inTransit = event.data.inTransit;
        player.nearestStopId = event.data.nearestStopId ?? null;
      }
    },
    WsEvent.ROOM_STATE_UPDATED,
  ),
  "phase.hide.started": def(
    "phase.hide.started",
    EventVisibility.PUBLIC,
    schema(["roundNumber"], { roundNumber: "number", hideEndsAt: "string" }),
    (state, event) => {
      state.phase = "Hide";
      state.roundNumber = event.data.roundNumber;
    },
  ),
  "phase.seek.started": def(
    "phase.seek.started",
    EventVisibility.PUBLIC,
    schema(["seekEndsAt"], { seekEndsAt: "string", hidingZone: ["object", "null"] }),
    (state) => {
      state.phase = "Seek";
    },
  ),
  "phase.end_game.started": def(
    "phase.end_game.started",
    EventVisibility.PUBLIC,
    schema([], { triggeredBySeekerId: "string", hiderFixedSpot: ["object", "null"] }),
    (state) => {
      state.phase = "EndGame";
    },
  ),
  "location.updated": def(
    "location.updated",
    EventVisibility.TEAM,
    schema(["playerId", "ts", "signature", "lat", "lng"], {
      playerId: "string",
      role: "string",
      lat: "number",
      lng: "number",
      accuracy: "number",
      ts: "string",
      signature: "string",
    }),
    (state, event) => {
      const player = ensurePlayerProjection(state, event.data.playerId);
      if (player) {
        player.lastLocationTs = event.data.ts;
        player.location = {
          lat: Number(event.data.lat),
          lng: Number(event.data.lng),
          accuracy: Number(event.data.accuracy ?? 0),
          ts: event.data.ts,
        };
      }
    },
    WsEvent.PLAYER_LOCATION_UPDATED,
  ),
  "fairplay.speed_anomaly": def(
    "fairplay.speed_anomaly",
    EventVisibility.PRIVATE,
    schema(["playerId", "speedMps", "threshold"], { playerId: "string", speedMps: "number", threshold: "number" }),
    () => {},
  ),
  "question.asked": def(
    "question.asked",
    EventVisibility.PUBLIC,
    schema(["id", "playerId", "category", "prompt", "status"], {
      id: "string",
      playerId: "string",
      category: "string",
      prompt: "string",
      status: "string",
    }),
    (state, event) => {
      const q = event.data;
      state.pendingQuestionId = q.id;
      state.questions[q.id] = {
        status: q.status ?? "pending",
        playerId: q.playerId,
        category: q.category,
      };
    },
    WsEvent.QUESTION_ASKED,
  ),
  "question.randomized": def(
    "question.randomized",
    EventVisibility.PRIVATE,
    schema(["questionId"], { questionId: "string" }),
    () => {},
  ),
  "question.answered": def(
    "question.answered",
    EventVisibility.PUBLIC,
    schema(["questionId", "playerId"], { questionId: "string", playerId: "string", timedOut: "boolean" }),
    (state, event) => {
      const qid = event.data.questionId;
      if (state.questions[qid]) {
        state.questions[qid].status = "answered";
      }
      if (state.pendingQuestionId === qid) {
        state.pendingQuestionId = null;
      }
    },
    WsEvent.QUESTION_ANSWERED,
  ),
  "question.vetoed": def(
    "question.vetoed",
    EventVisibility.PUBLIC,
    schema(["questionId"], { questionId: "string" }),
    (state, event) => {
      const qid = event.data.questionId;
      if (state.questions[qid]) {
        state.questions[qid].status = "vetoed";
      }
      if (state.pendingQuestionId === qid) {
        state.pendingQuestionId = null;
      }
    },
    WsEvent.QUESTION_VETOED,
  ),
  "question.timeout": def(
    "question.timeout",
    EventVisibility.PUBLIC,
    schema(["questionId"], { questionId: "string", dueAt: "string" }),
    (state, event) => {
      const qid = event.data.questionId;
      if (state.questions[qid]) {
        state.questions[qid].status = "timeout";
      }
    },
  ),
  "question.reward.skipped": def(
    "question.reward.skipped",
    EventVisibility.PRIVATE,
    schema(["questionId", "reason"], { questionId: "string", reason: "string" }),
    () => {},
  ),
  "question.reward.selected": def(
    "question.reward.selected",
    EventVisibility.PRIVATE,
    schema([], { keptCardIds: "array", discardedCardIds: "array" }),
    () => {},
  ),
  "map.annotation.added": def(
    "map.annotation.added",
    EventVisibility.TEAM,
    schema(["annotationId", "playerId", "layer", "geometryType", "geometry"], {
      annotationId: "string",
      playerId: "string",
      layer: "string",
      geometryType: "string",
      geometry: "object",
      label: "string",
      sourceQuestionId: ["string", "null"],
      createdAt: "string",
    }),
    (state, event) => {
      if (!Array.isArray(state.mapAnnotations)) {
        state.mapAnnotations = [];
      }
      state.mapAnnotations.push({
        id: event.data.annotationId,
        annotationId: event.data.annotationId,
        playerId: event.data.playerId,
        layer: event.data.layer,
        geometryType: event.data.geometryType,
        geometry: deepClone(event.data.geometry),
        label: event.data.label ?? "",
        sourceQuestionId: event.data.sourceQuestionId ?? null,
        createdAt: event.data.createdAt ?? event.ts ?? null,
      });
    },
  ),
  "card.drawn": def(
    "card.drawn",
    EventVisibility.PRIVATE,
    schema([], { count: "number", cardIds: "array", source: "string", questionId: "string" }),
    () => {},
    WsEvent.CARD_DRAWN,
  ),
  "card.cast": def(
    "card.cast",
    EventVisibility.PUBLIC,
    schema(["cardId", "targetPlayerId"], { cardId: "string", targetPlayerId: "string", effect: "object" }),
    () => {},
    WsEvent.CARD_PLAYED,
  ),
  "card.effect.consumed": def(
    "card.effect.consumed",
    EventVisibility.PRIVATE,
    schema(["effectId", "kind"], { effectId: "string", kind: "string" }),
    () => {},
  ),
  "powerup.discard_draw.resolved": def(
    "powerup.discard_draw.resolved",
    EventVisibility.PRIVATE,
    schema([], { discardedCardIds: "array", drawnCardIds: "array", drawCountActual: "number" }),
    () => {},
  ),
  "powerup.hand_limit_expanded": def(
    "powerup.hand_limit_expanded",
    EventVisibility.PRIVATE,
    schema(["increment", "newMaxHandLimit"], { increment: "number", newMaxHandLimit: "number" }),
    () => {},
  ),
  "dice.rolled": def(
    "dice.rolled",
    EventVisibility.PUBLIC,
    schema(["id", "playerId", "results", "proof"], {
      id: "string",
      playerId: "string",
      results: "array",
      proof: "string",
    }),
    () => {},
    WsEvent.DICE_ROLLED,
  ),
  "clue.shared": def(
    "clue.shared",
    EventVisibility.PUBLIC,
    schema(["id", "playerId", "text"], { id: "string", playerId: "string", text: "string" }),
    () => {},
  ),
  "catch.claimed": def(
    "catch.claimed",
    EventVisibility.PUBLIC,
    schema(["id", "seekerId", "hiderId", "visualConfirmed"], {
      id: "string",
      seekerId: "string",
      hiderId: "string",
      visualConfirmed: "boolean",
    }),
    (state, event) => {
      state.phase = "Caught";
      state.pendingCatchClaimId = event.data.id;
    },
    WsEvent.CATCH_CLAIMED,
  ),
  "catch.auto_evaluated": def(
    "catch.auto_evaluated",
    EventVisibility.PUBLIC,
    schema(["claimId", "canAutoResolve"], { claimId: "string", canAutoResolve: "boolean", success: "boolean" }),
    () => {},
  ),
  "catch.resolved": def(
    "catch.resolved",
    EventVisibility.PUBLIC,
    schema(["claimId", "result"], { claimId: "string", result: "string", reason: ["string", "null"] }),
    (state, event) => {
      if (state.pendingCatchClaimId === event.data.claimId) {
        state.pendingCatchClaimId = null;
      }
    },
    WsEvent.CATCH_RESULT,
  ),
  "catch.failed.return_to_seek": def(
    "catch.failed.return_to_seek",
    EventVisibility.PUBLIC,
    schema(["seekEndsAt", "reason"], { seekEndsAt: "string", reason: "string" }),
    (state) => {
      state.phase = "Seek";
    },
  ),
  "catch.timeout_auto_failed": def(
    "catch.timeout_auto_failed",
    EventVisibility.PUBLIC,
    schema(["claimId"], { claimId: "string" }),
    (state, event) => {
      if (state.pendingCatchClaimId === event.data.claimId) {
        state.pendingCatchClaimId = null;
      }
    },
  ),
  "round.paused": def(
    "round.paused",
    EventVisibility.PUBLIC,
    schema(["reason", "pausedAt"], { reason: "string", pausedAt: "string" }),
    (state) => {
      state.paused = true;
    },
    WsEvent.ROOM_STATE_UPDATED,
  ),
  "round.resumed": def(
    "round.resumed",
    EventVisibility.PUBLIC,
    schema(["reason", "resumedAt"], { reason: "string", resumedAt: "string", shiftedSec: "number" }),
    (state) => {
      state.paused = false;
    },
    WsEvent.ROOM_STATE_UPDATED,
  ),
  "dispute.created": def(
    "dispute.created",
    EventVisibility.PUBLIC,
    schema(["disputeId", "type"], { disputeId: "string", type: "string" }),
    (state, event) => {
      state.disputes[event.data.disputeId] = {
        status: "open",
        type: event.data.type,
      };
    },
    WsEvent.DISPUTE_OPENED,
  ),
  "dispute.voted": def(
    "dispute.voted",
    EventVisibility.PUBLIC,
    schema(["disputeId", "vote"], { disputeId: "string", vote: "string", votesCollected: "number" }),
    () => {},
  ),
  "dispute.resolved": def(
    "dispute.resolved",
    EventVisibility.PUBLIC,
    schema(["disputeId", "decision"], { disputeId: "string", decision: "string", byVote: "boolean" }),
    (state, event) => {
      state.disputes[event.data.disputeId] = {
        ...(state.disputes[event.data.disputeId] ?? {}),
        status: "resolved",
        decision: event.data.decision,
      };
    },
    WsEvent.DISPUTE_RESOLVED,
  ),
  "evidence.upload.init": def(
    "evidence.upload.init",
    EventVisibility.PUBLIC,
    schema(["evidenceId", "type", "expiresAt"], { evidenceId: "string", type: "string", expiresAt: "string" }),
    (state, event) => {
      state.evidence[event.data.evidenceId] = {
        status: "pending_upload",
        type: event.data.type,
      };
    },
  ),
  "evidence.upload.completed": def(
    "evidence.upload.completed",
    EventVisibility.PUBLIC,
    schema(["evidenceId", "storageKey"], { evidenceId: "string", storageKey: "string", sizeBytes: ["number", "null"] }),
    (state, event) => {
      state.evidence[event.data.evidenceId] = {
        ...(state.evidence[event.data.evidenceId] ?? {}),
        status: "completed",
        storageKey: event.data.storageKey,
      };
    },
  ),
  "round.prepared": def(
    "round.prepared",
    EventVisibility.PUBLIC,
    schema(["nextRoundNumber"], { nextRoundNumber: "number" }),
    (state, event) => {
      state.phase = "Lobby";
      state.pendingQuestionId = null;
      state.pendingCatchClaimId = null;
      state.summary = null;
      state.roundNumber = event.data.nextRoundNumber - 1;
    },
  ),
  "summary.generated": def(
    "summary.generated",
    EventVisibility.PUBLIC,
    schema(
      ["winner", "reason"],
      {
        winner: "string",
        reason: "string",
        effectiveHideDurationSec: "number",
        hideDurationSec: "number",
        seekDurationSec: "number",
        resolvedAt: "string",
        resolvedAtMs: "number",
        hider: ["object", "null"],
        hidingZone: ["object", "null"],
        seekerTrails: "array",
        players: "array",
        scores: "object",
      },
    ),
    (state, event) => {
      state.phase = "Summary";
      state.summary = event.data;
    },
    WsEvent.SUMMARY_READY,
  ),
  "curse.expired": def(
    "curse.expired",
    EventVisibility.PUBLIC,
    schema(["remaining"], { remaining: "number" }),
    () => {},
    WsEvent.CURSE_RESOLVED,
  ),
  "curse.movement_blocked": def(
    "curse.movement_blocked",
    EventVisibility.PUBLIC,
    schema(["movedMeters", "maxMovementWhenLockedMeters"], { movedMeters: "number", maxMovementWhenLockedMeters: "number" }),
    () => {},
  ),
});

export const EVENT_PROTOCOL = PROTOCOL;

export function getEventProtocol(type) {
  return PROTOCOL[type] ?? null;
}

export function validateEventPayload(type, payload) {
  const protocol = getEventProtocol(type);
  if (!protocol) {
    return {
      ok: false,
      errors: [`Unknown event type: ${type}`],
    };
  }
  return validatePayloadSchema(protocol.payloadSchema, payload);
}

export function applyEventToProjection(state, event) {
  const protocol = getEventProtocol(event.type);
  if (!protocol) {
    throw new Error(`Unknown event type: ${event.type}`);
  }
  const next = state ? deepClone(state) : createProjection(event.roomId ?? null);
  if (!next.roomId && event.roomId) {
    next.roomId = event.roomId;
  }
  baseApply(next, event);
  protocol.apply(next, event);
  return next;
}

export function replayEventProjection(events, initialState = null) {
  let state = initialState ? deepClone(initialState) : createProjection();
  for (const event of events) {
    state = applyEventToProjection(state, event);
  }
  return state;
}

const internalToWs = Object.freeze(
  Object.fromEntries(
    Object.values(PROTOCOL).map((entry) => [entry.type, entry.wsEvent]),
  ),
);

export function toWsEvent(eventType) {
  return internalToWs[eventType] ?? WsEvent.ROOM_STATE_UPDATED;
}

export function getRoundActionCapability(action) {
  return ROUND_ACTION_CAPABILITY[action] ?? null;
}

export function listAllowedRoundActions(capabilities = {}) {
  return Object.entries(ROUND_ACTION_CAPABILITY)
    .filter(([, capability]) => Boolean(capabilities[capability]))
    .map(([action]) => action);
}
