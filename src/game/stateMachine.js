import crypto from "node:crypto";
import {
  DEFAULT_DECK,
  DEFAULT_RULES,
  GameScale,
  Phase,
  QUESTION_CATEGORIES,
  QUESTION_CATEGORY_CONFIG,
  RADAR_DISTANCE_OPTIONS_METERS,
  Role,
  SCALE_PRESETS,
  TENTACLES_OPTIONS_BY_SCALE,
  Visibility,
} from "./models.js";
import {
  getMapProviderAdapter,
  normalizeMapProvider,
} from "../integrations/mapProviderAdapter.js";
import {
  findNearestTransitStop,
  getDefaultTransitPackId,
  getTransitPack,
  importTransitPack,
  listTransitPacks,
} from "../integrations/transitPack.js";
import {
  getRoundActionCapability,
  listAllowedRoundActions,
  RoundAction,
} from "../realtime/events.js";
import { appendRoomEvent, deepCopy, getRoomCursor, newId, nowIso, nowMs, rooms } from "./store.js";

function hash(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function randomIntInclusive(min, max) {
  return crypto.randomInt(min, max + 1);
}

function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function isRole(value) {
  return value === Role.HIDER || value === Role.SEEKER || value === Role.OBSERVER;
}

function isScale(value) {
  return value === GameScale.SMALL || value === GameScale.MEDIUM || value === GameScale.LARGE;
}

function normalizeScale(value) {
  const normalized = String(value ?? "").toLowerCase();
  return isScale(normalized) ? normalized : GameScale.SMALL;
}

function normalizeQuestionCategory(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "photos") {
    return "photo";
  }
  if (normalized === "tentacle") {
    return "tentacles";
  }
  return normalized;
}

function scalePreset(scale) {
  return SCALE_PRESETS[scale] ?? SCALE_PRESETS[GameScale.SMALL];
}

function buildRulesForScale(scale, overrides = {}) {
  const preset = scalePreset(scale);
  return {
    ...DEFAULT_RULES,
    hideDurationSec: preset.hideDurationSec,
    hidingZoneRadiusMeters: preset.hidingZoneRadiusMeters,
    photoAnswerLimitSec: preset.photoAnswerLimitSec,
    thermometerDistanceOptionsMeters: [...preset.thermometerDistanceOptionsMeters],
    ...(overrides ?? {}),
  };
}

function getQuestionConfig(category, scale) {
  const config = QUESTION_CATEGORY_CONFIG[category];
  assert(config, `Unsupported question category: ${category}`, 400);
  assert(config.scales.includes(scale), `Question category not available in this scale: ${category}`, 400);
  return config;
}

function getQuestionAnswerLimitSec(category, room) {
  const config = getQuestionConfig(category, room.scale);
  if (category === "photo") {
    return Number(room.rules.photoAnswerLimitSec ?? config.answerLimitSec);
  }
  return Number(config.answerLimitSec);
}

function getQuestionOptionPool(category, room) {
  if (category === "radar") {
    return [...RADAR_DISTANCE_OPTIONS_METERS];
  }
  if (category === "thermometer") {
    return [...(room.rules.thermometerDistanceOptionsMeters ?? scalePreset(room.scale).thermometerDistanceOptionsMeters)];
  }
  if (category === "tentacles") {
    const options = TENTACLES_OPTIONS_BY_SCALE[room.scale];
    return options ? [...options.radiusOptionsMeters] : [];
  }
  return [];
}

function pickRandomOption(category, room, currentOption = null) {
  const pool = getQuestionOptionPool(category, room);
  const choices = pool.filter((item) => String(item) !== String(currentOption));
  if (choices.length === 0) {
    return currentOption;
  }
  return choices[crypto.randomInt(0, choices.length)];
}

function nowQuestionKey(category, optionKey) {
  return `${category}|${String(optionKey ?? "_none_").toLowerCase()}`;
}

function getMaxHandLimit(room, player) {
  const bonus = Math.max(0, Number(player.handLimitBonus ?? 0));
  return Math.max(0, Number(room.rules.handLimit) + bonus);
}

function sanitizeCardTemplate(card) {
  return {
    templateId: card.templateId,
    name: card.name,
    type: card.type,
    effect: card.effect,
  };
}

function currentActivePhase(room) {
  if (room.round.endGameStartedAtMs) {
    return Phase.END_GAME;
  }
  return Phase.SEEK;
}

function isRoundPaused(room) {
  return Boolean(room.pause?.isPaused);
}

function roomMapAdapter(room) {
  return getMapProviderAdapter(room.mapProvider ?? room.mapSource);
}

function evaluatePlaceLegitimacy(room, placeDetails) {
  const placeId = placeDetails?.placeId ?? null;
  const reviewCount = Number(placeDetails?.review_count ?? 0);
  const override = placeId ? room.poiLegitimacyOverrides?.[placeId] : null;
  if (typeof override === "boolean") {
    return {
      isLegitimate: override,
      rule: "room_override_vote",
      reviewCount,
      threshold: 5,
    };
  }
  return {
    isLegitimate: reviewCount >= 5,
    rule: "default_review_threshold",
    reviewCount,
    threshold: 5,
  };
}

function isRoomPhaseInteractive(room) {
  return room.phase === Phase.HIDE || room.phase === Phase.SEEK || room.phase === Phase.END_GAME || room.phase === Phase.CAUGHT;
}

function assert(condition, message, status = 400) {
  if (!condition) {
    const error = new Error(message);
    error.status = status;
    throw error;
  }
}

function requireRoom(roomId) {
  const room = rooms.get(roomId);
  assert(room, `Room not found: ${roomId}`, 404);
  return room;
}

function requirePlayer(room, playerId) {
  const player = room.players.find((item) => item.id === playerId);
  assert(player, `Player not found: ${playerId}`, 404);
  return player;
}

function appendEvent(room, details) {
  return appendRoomEvent(room, details);
}

function clearRoundState(room) {
  room.round = {
    number: room.round.number,
    hideStartedAtMs: null,
    hideEndsAtMs: null,
    seekStartedAtMs: null,
    seekEndsAtMs: null,
    endGameStartedAtMs: null,
    hidingZone: null,
    hiderFixedSpot: null,
    pendingCatchClaim: null,
    pendingQuestionId: null,
    pendingRewardChoice: null,
    questionRepeatCounts: {},
    questions: [],
    answers: [],
    clues: [],
    summary: null,
  };
  room.mapAnnotations = [];
}

function canStartRound(room) {
  const hiders = room.players.filter((item) => item.role === Role.HIDER);
  const seekers = room.players.filter((item) => item.role === Role.SEEKER);
  const requiredPlayers = room.players.filter((item) => item.role !== Role.OBSERVER);
  const allReady = requiredPlayers.length > 0 && requiredPlayers.every((item) => item.ready);
  return hiders.length === 1 && seekers.length >= 1 && allReady;
}

function ensureDeck(room) {
  if (room.deck.length === 0) {
    room.deck = shuffle(room.discard.length > 0 ? room.discard.map((item) => ({ ...item })) : DEFAULT_DECK.map((item) => ({ ...item })));
    room.discard = [];
  }
}

function haversineMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);

  return 2 * earthRadius * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function getActiveEffects(player, now = nowMs()) {
  return (player.activeCurses ?? []).filter((effect) => effect.expiresAtMs > now);
}

function buildRestrictionState(player, now = nowMs()) {
  const active = getActiveEffects(player, now);
  const categoryBans = new Set();
  let mapCircleOnly = false;
  let movementLocked = false;
  let blurNextAnswer = false;
  const questionCostOverrides = {};

  for (const effect of active) {
    if (effect.effect?.kind === "question_category_ban" && effect.effect.category) {
      categoryBans.add(String(effect.effect.category).toLowerCase());
    }
    if (effect.effect?.kind === "map_tool_limit" && effect.effect.mode === "circle_only") {
      mapCircleOnly = true;
    }
    if (effect.effect?.kind === "movement_lock") {
      movementLocked = true;
    }
    if (effect.effect?.kind === "answer_blur_once") {
      blurNextAnswer = true;
    }
    if (effect.effect?.kind === "question_cost_override" && effect.effect.overrides) {
      Object.assign(questionCostOverrides, effect.effect.overrides);
    }
  }

  return {
    activeEffects: active,
    blockedQuestionCategories: [...categoryBans],
    mapCircleOnly,
    movementLocked,
    blurNextAnswer,
    questionCostOverrides,
  };
}

function questionAskedAtMs(question) {
  if (Number.isFinite(question.askedAtMs)) {
    return question.askedAtMs;
  }
  return Date.parse(question.askedAt);
}

function getLastQuestionForPlayer(room, playerId) {
  for (let i = room.round.questions.length - 1; i >= 0; i -= 1) {
    if (room.round.questions[i].playerId === playerId) {
      return room.round.questions[i];
    }
  }
  return null;
}

function seekElapsedSec(room, now = nowMs()) {
  if (!room.round.seekStartedAtMs) {
    return 0;
  }
  return Math.max(0, Math.floor((now - room.round.seekStartedAtMs) / 1000));
}

function estimateProximityDurationSec(seekerTrail, hiderTrail, distanceThresholdMeters, maxPairTimeDeltaSec) {
  const maxPairTimeDeltaMs = Math.max(0, Number(maxPairTimeDeltaSec) * 1000);
  const seekerRecent = seekerTrail.slice(-120);
  const hiderRecent = hiderTrail.slice(-120);
  if (seekerRecent.length === 0 || hiderRecent.length === 0) {
    return 0;
  }

  const matchedTimes = [];
  for (const seekerPoint of seekerRecent) {
    let bestPoint = null;
    let bestDelta = Number.POSITIVE_INFINITY;

    for (const hiderPoint of hiderRecent) {
      const delta = Math.abs(seekerPoint.tsMs - hiderPoint.tsMs);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestPoint = hiderPoint;
      }
    }

    if (!bestPoint || bestDelta > maxPairTimeDeltaMs) {
      continue;
    }
    const distance = haversineMeters(seekerPoint, bestPoint);
    if (distance <= distanceThresholdMeters) {
      matchedTimes.push(Math.floor((seekerPoint.tsMs + bestPoint.tsMs) / 2));
    }
  }

  if (matchedTimes.length <= 1) {
    return 0;
  }

  matchedTimes.sort((a, b) => a - b);
  let segmentStart = matchedTimes[0];
  let prev = matchedTimes[0];
  let bestMs = 0;

  for (let i = 1; i < matchedTimes.length; i += 1) {
    const cur = matchedTimes[i];
    if (cur - prev <= maxPairTimeDeltaMs) {
      prev = cur;
      bestMs = Math.max(bestMs, prev - segmentStart);
      continue;
    }
    segmentStart = cur;
    prev = cur;
  }

  return Math.floor(bestMs / 1000);
}

function evaluateDistanceCatch(room, claim) {
  const seeker = requirePlayer(room, claim.seekerId);
  const hider = requirePlayer(room, claim.hiderId);

  if (!seeker.lastLocation || !hider.lastLocation) {
    return {
      canAutoResolve: false,
      reason: "missing_location_reports",
    };
  }

  const distanceThresholdMeters = Math.max(
    1,
    Number(claim.details?.distanceMeters ?? room.rules.catchDistanceMeters),
  );
  const holdSeconds = Math.max(
    0,
    Number(claim.details?.holdSeconds ?? room.rules.catchHoldSeconds),
  );
  const maxReportAgeSec = Math.max(
    1,
    Number(claim.details?.maxReportAgeSec ?? room.rules.catchMaxReportAgeSec),
  );

  const instantDistanceMeters = haversineMeters(seeker.lastLocation, hider.lastLocation);
  const snapshotDeltaSec = Number(
    (Math.abs(seeker.lastLocation.tsMs - hider.lastLocation.tsMs) / 1000).toFixed(2),
  );
  const proximityDurationSec = estimateProximityDurationSec(
    seeker.locationTrail,
    hider.locationTrail,
    distanceThresholdMeters,
    maxReportAgeSec,
  );

  const success =
    snapshotDeltaSec <= maxReportAgeSec &&
    instantDistanceMeters <= distanceThresholdMeters &&
    proximityDurationSec >= holdSeconds;

  return {
    canAutoResolve: true,
    success,
    reason: success ? "distance_threshold_met" : "distance_threshold_not_met",
    metrics: {
      instantDistanceMeters: Number(instantDistanceMeters.toFixed(2)),
      snapshotDeltaSec,
      distanceThresholdMeters,
      holdSecondsRequired: holdSeconds,
      matchedProximityDurationSec: proximityDurationSec,
      maxReportAgeSec,
    },
  };
}

function applyFailedCatchPenalty(room, actorId, reason, extra = {}) {
  room.round.pendingCatchClaim = null;
  room.phase = currentActivePhase(room);
  if (room.rules.failedCatchPenaltyMode === "extra_time") {
    room.round.seekEndsAtMs += room.rules.failedCatchPenaltySec * 1000;
  }

  const payload = {
    penaltyMode: room.rules.failedCatchPenaltyMode,
    penaltySec: room.rules.failedCatchPenaltySec,
    seekEndsAt: new Date(room.round.seekEndsAtMs).toISOString(),
    reason,
    ...extra,
  };

  appendEvent(room, {
    type: "catch.failed.return_to_seek",
    actorId,
    data: payload,
  });

  return {
    phase: room.phase,
    seekEndsAt: payload.seekEndsAt,
    penalty: {
      mode: payload.penaltyMode,
      sec: payload.penaltySec,
      reason,
    },
  };
}

function activatePause(room, actorId, reason) {
  if (isRoundPaused(room)) {
    return {
      paused: true,
      pausedAt: new Date(room.pause.pausedAtMs).toISOString(),
      reason: room.pause.reason,
    };
  }

  const ts = nowMs();
  room.pause = {
    isPaused: true,
    pausedAtMs: ts,
    reason: reason ?? "manual_pause",
  };

  appendEvent(room, {
    type: "round.paused",
    actorId,
    data: {
      reason: room.pause.reason,
      pausedAt: new Date(ts).toISOString(),
    },
  });

  return {
    paused: true,
    pausedAt: new Date(ts).toISOString(),
    reason: room.pause.reason,
  };
}

function shiftRoomTimersBy(room, deltaMs) {
  if (deltaMs <= 0) {
    return;
  }
  if (room.round.hideEndsAtMs) {
    room.round.hideEndsAtMs += deltaMs;
  }
  if (room.round.seekEndsAtMs) {
    room.round.seekEndsAtMs += deltaMs;
  }
  if (room.round.pendingCatchClaim?.expiresAtMs) {
    room.round.pendingCatchClaim.expiresAtMs += deltaMs;
  }
  const pendingQuestion = room.round.questions.find((item) => item.id === room.round.pendingQuestionId);
  if (pendingQuestion?.dueAtMs) {
    pendingQuestion.dueAtMs += deltaMs;
    pendingQuestion.dueAt = new Date(pendingQuestion.dueAtMs).toISOString();
  }
}

function deactivatePause(room, actorId, reason) {
  if (!isRoundPaused(room)) {
    return {
      paused: false,
      resumedAt: nowIso(),
      shiftedSec: 0,
    };
  }

  const resumedAtMs = nowMs();
  const pausedAtMs = room.pause.pausedAtMs ?? resumedAtMs;
  const deltaMs = Math.max(0, resumedAtMs - pausedAtMs);
  shiftRoomTimersBy(room, deltaMs);

  room.pause = {
    isPaused: false,
    pausedAtMs: null,
    reason: null,
  };

  appendEvent(room, {
    type: "round.resumed",
    actorId,
    data: {
      reason: reason ?? "manual_resume",
      resumedAt: new Date(resumedAtMs).toISOString(),
      shiftedSec: Math.floor(deltaMs / 1000),
    },
  });

  return {
    paused: false,
    resumedAt: new Date(resumedAtMs).toISOString(),
    shiftedSec: Math.floor(deltaMs / 1000),
  };
}

function computeTimeBonusSecFromHand(hider) {
  return hider.hand.reduce((sum, card) => {
    if (card.type === "time_bonus_fixed" && Number.isFinite(Number(card.effect?.minutes))) {
      return sum + Number(card.effect.minutes) * 60;
    }
    return sum;
  }, 0);
}

function tryEnterEndGame(room, seekerId) {
  if (room.phase !== Phase.SEEK || !room.round.hidingZone?.center || !room.round.hidingZone?.radiusMeters) {
    return false;
  }
  const seeker = requirePlayer(room, seekerId);
  if (seeker.inTransit || !seeker.lastLocation) {
    return false;
  }
  const center = room.round.hidingZone.center;
  const distance = haversineMeters(center, seeker.lastLocation);
  if (distance > room.round.hidingZone.radiusMeters) {
    return false;
  }

  room.phase = Phase.END_GAME;
  room.round.endGameStartedAtMs = nowMs();
  const hider = room.players.find((item) => item.role === Role.HIDER);
  room.round.hiderFixedSpot = hider?.lastLocation ?? null;

  appendEvent(room, {
    type: "phase.end_game.started",
    actorId: seeker.id,
    data: {
      triggeredBySeekerId: seeker.id,
      distanceToZoneCenterMeters: Number(distance.toFixed(2)),
      hiderFixedSpot: room.round.hiderFixedSpot,
    },
  });
  return true;
}

function buildPlayerCapabilities(room, player) {
  const now = nowMs();
  const restrictions = buildRestrictionState(player, now);
  const lastQuestion = getLastQuestionForPlayer(room, player.id);
  const cooldownMs = Math.max(0, Number(room.rules.questionCooldownSec) * 1000);
  const nextQuestionAtMs =
    lastQuestion && Number.isFinite(questionAskedAtMs(lastQuestion))
      ? questionAskedAtMs(lastQuestion) + cooldownMs
      : null;

  return {
    canAskQuestion:
      player.role === Role.SEEKER &&
      (room.phase === Phase.SEEK || room.phase === Phase.END_GAME) &&
      !isRoundPaused(room) &&
      !room.round.pendingQuestionId,
    canClaimCatch:
      player.role === Role.SEEKER &&
      (room.phase === Phase.SEEK || room.phase === Phase.END_GAME) &&
      !isRoundPaused(room),
    canDrawMap: player.role === Role.SEEKER,
    canDrawCard:
      player.role === Role.HIDER &&
      (room.phase === Phase.SEEK || room.phase === Phase.END_GAME) &&
      !isRoundPaused(room),
    canCastCard:
      player.role === Role.HIDER &&
      (room.phase === Phase.SEEK || room.phase === Phase.END_GAME) &&
      !isRoundPaused(room),
    canRollDice: isRoomPhaseInteractive(room) && !isRoundPaused(room),
    canAnswerQuestion:
      player.role === Role.HIDER &&
      (room.phase === Phase.SEEK || room.phase === Phase.END_GAME) &&
      Boolean(room.round.pendingQuestionId),
    canShareClue:
      player.role === Role.HIDER &&
      (room.phase === Phase.SEEK || room.phase === Phase.END_GAME) &&
      !isRoundPaused(room) &&
      seekElapsedSec(room, now) >= room.rules.hiderClueUnlockAfterSec,
    canPause: !isRoundPaused(room),
    canResume: isRoundPaused(room),
    canToggleTransit: room.phase !== Phase.LOBBY,
    pendingQuestionId: room.round.pendingQuestionId,
    blockedQuestionCategories: restrictions.blockedQuestionCategories,
    mapToolMode: restrictions.mapCircleOnly ? "circle_only" : "all",
    movementLocked: restrictions.movementLocked,
    blurNextAnswer: restrictions.blurNextAnswer,
    nextQuestionAt: nextQuestionAtMs ? new Date(nextQuestionAtMs).toISOString() : null,
    maxHandLimit: getMaxHandLimit(room, player),
    streetViewAllowed: Boolean(room.rules.allowStreetView),
  };
}

function buildAllowedActions(capabilities) {
  return listAllowedRoundActions(capabilities);
}

function assertRoundActionAllowed(room, player, action) {
  const capability = getRoundActionCapability(action);
  assert(capability, `Unsupported round action: ${String(action)}`, 400);
  const capabilities = buildPlayerCapabilities(room, player);
  const allowedActions = buildAllowedActions(capabilities);
  assert(
    allowedActions.includes(action),
    `Action not allowed by current capabilities: ${String(action)}`,
    403,
  );
  return {
    capability,
    capabilities,
    allowedActions,
  };
}

function projectedLocation(viewerRole, targetPlayer, room) {
  if (!targetPlayer.lastLocation) {
    return null;
  }
  if (viewerRole === Role.OBSERVER) {
    return targetPlayer.lastLocation;
  }
  if (viewerRole === Role.HIDER) {
    return targetPlayer.lastLocation;
  }
  if (targetPlayer.role === Role.HIDER) {
    if (room.phase === Phase.SUMMARY && room.rules.revealHiderPathInSummary) {
      return targetPlayer.lastLocation;
    }
    return null;
  }
  return targetPlayer.lastLocation;
}

function projectEvents(room, viewerRole) {
  return room.events.filter((item) => {
    if (viewerRole === Role.OBSERVER) {
      return true;
    }
    if (item.visibility === Visibility.PUBLIC) {
      return true;
    }
    if (item.visibility === Visibility.HIDER && viewerRole === Role.HIDER) {
      return true;
    }
    if (item.visibility === Visibility.SEEKERS && viewerRole === Role.SEEKER) {
      return true;
    }
    return false;
  });
}

function computeSeekDurationSec(room) {
  if (!room.round.seekStartedAtMs) {
    return 0;
  }
  const endMs = room.phase === Phase.SUMMARY ? room.round.summary?.resolvedAtMs ?? nowMs() : nowMs();
  return Math.max(0, Math.floor((endMs - room.round.seekStartedAtMs) / 1000));
}

function summarizeLocation(point) {
  if (!point) {
    return null;
  }
  return {
    lat: Number(point.lat),
    lng: Number(point.lng),
    accuracy: Number(point.accuracy ?? 0),
    ts: point.ts ?? null,
  };
}

function summarizeLocationTrail(points, limit = 120) {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }

  const slice = points.slice(-limit);
  return slice.map((point) => summarizeLocation(point)).filter(Boolean);
}

function computeTrailDistanceMeters(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return 0;
  }

  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += haversineMeters(points[index - 1], points[index]);
  }
  return Number(total.toFixed(1));
}

function finalizeSummary(room, result) {
  const resolvedAtMs = nowMs();
  room.phase = Phase.SUMMARY;
  room.pause = {
    isPaused: false,
    pausedAtMs: null,
    reason: null,
  };
  const hideSec = room.round.hideStartedAtMs
    ? Math.max(0, Math.floor((Math.min(room.round.hideEndsAtMs ?? resolvedAtMs, resolvedAtMs) - room.round.hideStartedAtMs) / 1000))
    : 0;
  const seekSec = room.round.seekStartedAtMs
    ? Math.max(0, Math.floor((resolvedAtMs - room.round.seekStartedAtMs) / 1000))
    : 0;
  const hider = room.players.find((item) => item.role === Role.HIDER);
  const seekers = room.players.filter((item) => item.role === Role.SEEKER);
  const handTimeBonusSec = hider ? computeTimeBonusSecFromHand(hider) : 0;
  const effectiveHideSec = hideSec + handTimeBonusSec;

  room.round.summary = {
    winner: result.winner,
    reason: result.reason,
    hideDurationSec: hideSec,
    handTimeBonusSec,
    effectiveHideDurationSec: effectiveHideSec,
    seekDurationSec: seekSec,
    resolvedAtMs,
    resolvedAt: nowIso(),
    hider: hider
      ? {
          playerId: hider.id,
          name: hider.name,
          finalLocation: summarizeLocation(hider.lastLocation),
          fixedSpot: summarizeLocation(room.round.hiderFixedSpot),
        }
      : null,
    hidingZone: room.round.hidingZone
      ? {
          ...room.round.hidingZone,
          center: summarizeLocation(room.round.hidingZone.center),
        }
      : null,
    seekerTrails: seekers.map((player) => ({
      playerId: player.id,
      name: player.name,
      finalLocation: summarizeLocation(player.lastLocation),
      totalDistanceMeters: computeTrailDistanceMeters(player.locationTrail),
      points: summarizeLocationTrail(player.locationTrail),
    })),
    players: room.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      role: player.role,
      ready: Boolean(player.ready),
    })),
    scores: deepCopy(room.scores),
  };

  if (result.winner === "seekers") {
    room.scores.seekers.push(seekSec);
  } else {
    room.scores.hiderWins += 1;
  }

  room.round.pendingCatchClaim = null;
  appendEvent(room, {
    type: "summary.generated",
    actorId: result.actorId ?? null,
    data: room.round.summary,
  });
}

function transitionToSeek(room, reason) {
  const hider = room.players.find((item) => item.role === Role.HIDER);
  const zoneCenter = hider?.lastLocation
    ? {
        lat: hider.lastLocation.lat,
        lng: hider.lastLocation.lng,
      }
    : null;
  room.round.hidingZone = zoneCenter
    ? {
        center: zoneCenter,
        radiusMeters: Number(room.rules.hidingZoneRadiusMeters),
        generatedAt: nowIso(),
      }
    : null;

  room.phase = Phase.SEEK;
  room.round.seekStartedAtMs = nowMs();
  room.round.seekEndsAtMs = room.round.seekStartedAtMs + room.rules.seekDurationSec * 1000;
  appendEvent(room, {
    type: "phase.seek.started",
    data: {
      reason,
      seekEndsAt: new Date(room.round.seekEndsAtMs).toISOString(),
      hidingZone: room.round.hidingZone,
    },
  });
}

function startRound(room, actorId, reason = "manual_start") {
  assert(canStartRound(room), "Cannot start round: invalid roles or not everyone is ready", 400);
  clearRoundState(room);
  room.pause = {
    isPaused: false,
    pausedAtMs: null,
    reason: null,
  };
  if (!room.gameStartedAtMs) {
    room.gameStartedAtMs = nowMs();
    if (Number.isFinite(Number(room.rules.totalGameDurationSec)) && Number(room.rules.totalGameDurationSec) > 0) {
      room.gameEndsAtMs = room.gameStartedAtMs + Number(room.rules.totalGameDurationSec) * 1000;
    }
  }
  room.phase = Phase.HIDE;
  room.round.number += 1;
  room.round.hideStartedAtMs = nowMs();
  room.round.hideEndsAtMs = room.round.hideStartedAtMs + room.rules.hideDurationSec * 1000;

  appendEvent(room, {
    type: "phase.hide.started",
    actorId,
    data: {
      reason,
      roundNumber: room.round.number,
      hideEndsAt: new Date(room.round.hideEndsAtMs).toISOString(),
    },
  });
}

function rotateRoles(room) {
  const active = room.players.filter((player) => player.role !== Role.OBSERVER);
  if (active.length < 2) {
    return;
  }

  const seekers = active.filter((player) => player.role === Role.SEEKER);
  const hider = active.find((player) => player.role === Role.HIDER);
  if (!hider || seekers.length === 0) {
    return;
  }

  if (room.rules.roleRotationMode === "winner_hides" && room.round.summary?.winner === "seekers") {
    return;
  }

  if (room.rules.roleRotationMode === "loser_hides" && room.round.summary?.winner === "hider") {
    return;
  }

  const nextHider = seekers[0];
  hider.role = Role.SEEKER;
  nextHider.role = Role.HIDER;
}

export function createRoom(input = {}) {
  const roomId = newId("room");
  const scale = normalizeScale(input.scale);
  const rules = buildRulesForScale(scale, input.rules ?? {});
  const mapProvider = normalizeMapProvider(input.mapProvider ?? input.mapSource ?? rules.mapSource);
  const transitPackId = String(input.transitPackId ?? getDefaultTransitPackId() ?? "").trim() || null;
  if (transitPackId) {
    assert(getTransitPack(transitPackId), `Transit pack not found: ${transitPackId}`, 400);
  }
  const borderPolygonGeoJSON = input.borderPolygonGeoJSON ?? input.mapBoundary ?? null;
  const room = {
    id: roomId,
    name: input.name ?? `Room ${roomId.slice(-4)}`,
    scale,
    mode: input.mode ?? "1v2",
    mapProvider,
    mapSource: mapProvider,
    transitPackId,
    expansionEnabled: Boolean(input.expansionEnabled ?? true),
    totalRounds: Number.isFinite(Number(input.totalRounds)) ? Number(input.totalRounds) : null,
    mapBoundary: borderPolygonGeoJSON,
    borderPolygonGeoJSON,
    rules,
    config: {
      scale: scale.toUpperCase(),
      mapProvider,
      transitPackId,
      enableExpansionPackV1: Boolean(input.expansionEnabled ?? true),
      borderPolygonGeoJSON,
      timers: {
        hideSeconds: rules.hideDurationSec,
        answerSeconds: {
          default: 5 * 60,
          photo: rules.photoAnswerLimitSec,
        },
        nextRoundPrepSeconds: rules.prepWindowSec,
      },
      catchRules: {
        distanceMeters: rules.catchDistanceMeters,
        requireVisualConfirm: true,
      },
      questionRules: {
        oneAtATime: Boolean(rules.singlePendingQuestionOnly),
        repeatCostMultiplier: true,
      },
      logging: {
        retainDays: Number(input?.logging?.retainDays ?? 30),
        shareHiderTrackInSummary: Boolean(rules.revealHiderPathInSummary),
      },
    },
    phase: Phase.LOBBY,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    gameStartedAtMs: null,
    gameEndsAtMs: null,
    pause: {
      isPaused: false,
      pausedAtMs: null,
      reason: null,
    },
    players: [],
    round: {
      number: 0,
      hideStartedAtMs: null,
      hideEndsAtMs: null,
      seekStartedAtMs: null,
      seekEndsAtMs: null,
      endGameStartedAtMs: null,
      hidingZone: null,
      hiderFixedSpot: null,
      pendingCatchClaim: null,
      pendingQuestionId: null,
      pendingRewardChoice: null,
      questionRepeatCounts: {},
      questions: [],
      answers: [],
      clues: [],
      summary: null,
    },
    mapAnnotations: [],
    events: [],
    deck: shuffle(DEFAULT_DECK.map((item) => ({ ...item }))),
    discard: [],
    evidence: [],
    poiLegitimacyOverrides: {},
    disputes: [],
    scores: {
      seekers: [],
      hiderWins: 0,
    },
  };

  appendEvent(room, {
    type: "room.created",
    data: {
      roomId,
      mode: room.mode,
      scale: room.scale,
      mapProvider: room.mapProvider,
      transitPackId: room.transitPackId,
    },
  });

  rooms.set(room.id, room);
  return deepCopy(room);
}

export function listRooms() {
  return [...rooms.values()].map((room) => ({
    id: room.id,
    name: room.name,
    scale: room.scale,
    mapProvider: room.mapProvider,
    transitPackId: room.transitPackId,
    mode: room.mode,
    phase: room.phase,
    paused: Boolean(room.pause?.isPaused),
    players: room.players.length,
    round: room.round.number,
    updatedAt: room.updatedAt,
  }));
}

export function getRoom(roomId) {
  const room = requireRoom(roomId);
  return deepCopy(room);
}

export function listAvailableTransitPacks() {
  return deepCopy(listTransitPacks());
}

export function importCustomTransitPack(input) {
  const pack = importTransitPack(input);
  return deepCopy(pack);
}

export async function searchRoomPlaces(roomId, input) {
  const room = requireRoom(roomId);
  if (input?.playerId) {
    requirePlayer(room, input.playerId);
  }

  const adapter = roomMapAdapter(room);
  const query = String(input?.query ?? "").trim();
  const radiusM = Number(input?.radiusM ?? 5000);
  let center = input?.center ?? null;
  if (!center && input?.playerId) {
    const viewer = requirePlayer(room, input.playerId);
    if (viewer.lastLocation) {
      center = {
        lat: viewer.lastLocation.lat,
        lng: viewer.lastLocation.lng,
      };
    }
  }
  if (!center) {
    center = { lat: 31.2304, lng: 121.4737 };
  }

  const places = await adapter.searchPlaces(query, center, radiusM);
  return deepCopy({
    mapProvider: room.mapProvider,
    query,
    center,
    radiusM,
    places,
  });
}

export async function getRoomPlaceDetails(roomId, input) {
  const room = requireRoom(roomId);
  if (input?.playerId) {
    requirePlayer(room, input.playerId);
  }
  const placeId = String(input?.placeId ?? "").trim();
  assert(placeId.length > 0, "placeId is required");

  const adapter = roomMapAdapter(room);
  const details = await adapter.getPlaceDetails(placeId);
  assert(details, `Place not found: ${placeId}`, 404);
  const legitimacy = evaluatePlaceLegitimacy(room, details);

  return deepCopy({
    mapProvider: room.mapProvider,
    details,
    legitimacy,
  });
}

export async function reverseRoomAdminLevels(roomId, input) {
  const room = requireRoom(roomId);
  if (input?.playerId) {
    requirePlayer(room, input.playerId);
  }
  const lat = Number(input?.lat);
  const lng = Number(input?.lng);
  assert(Number.isFinite(lat) && Number.isFinite(lng), "lat and lng are required numbers");

  const adapter = roomMapAdapter(room);
  const adminLevels = await adapter.reverseGeocodeAdminLevels(lat, lng);
  return deepCopy({
    mapProvider: room.mapProvider,
    lat,
    lng,
    adminLevels,
  });
}

export function getRoomEvents(roomId, input = {}) {
  const room = requireRoom(roomId);
  const sinceMs = Number(input?.sinceMs ?? 0);
  const limit = Math.max(1, Math.min(5000, Number(input?.limit ?? 500)));
  const viewerRole = input?.playerId
    ? requirePlayer(room, input.playerId).role
    : null;
  const events = projectEvents(room, viewerRole)
    .filter((item) => {
      if (!Number.isFinite(sinceMs) || sinceMs <= 0) {
        return true;
      }
      const tsMs = Date.parse(item.ts);
      return Number.isFinite(tsMs) && tsMs >= sinceMs;
    })
    .slice(-limit);
  return deepCopy({
    roomId: room.id,
    count: events.length,
    events,
  });
}

export function initEvidenceUpload(roomId, input) {
  const room = requireRoom(roomId);
  const actor = requirePlayer(room, input?.playerId);
  const evidenceId = newId("evidence");
  const expiresAtMs = nowMs() + 10 * 60 * 1000;
  const item = {
    evidenceId,
    roomId: room.id,
    roundNumber: Number(input?.roundNumber ?? room.round.number),
    actorPlayerId: actor.id,
    type: String(input?.type ?? "photo"),
    mimeType: String(input?.mimeType ?? "application/octet-stream"),
    status: "pending_upload",
    metadata: input?.metadata ?? {},
    uploadUrl: `/uploads/${evidenceId}`,
    createdAt: nowIso(),
    completedAt: null,
    expiresAt: new Date(expiresAtMs).toISOString(),
    sizeBytes: null,
  };
  room.evidence.push(item);

  appendEvent(room, {
    type: "evidence.upload.init",
    actorId: actor.id,
    data: {
      evidenceId: item.evidenceId,
      type: item.type,
      expiresAt: item.expiresAt,
    },
  });

  return deepCopy({
    evidenceId: item.evidenceId,
    uploadUrl: item.uploadUrl,
    expiresAt: item.expiresAt,
  });
}

export function completeEvidenceUpload(roomId, input) {
  const room = requireRoom(roomId);
  const actor = requirePlayer(room, input?.playerId);
  const evidenceId = String(input?.evidenceId ?? "").trim();
  const item = room.evidence.find((entry) => entry.evidenceId === evidenceId);
  assert(item, `Evidence not found: ${evidenceId}`, 404);
  assert(item.status === "pending_upload", "Evidence upload already completed");
  assert(item.actorPlayerId === actor.id || actor.role === Role.OBSERVER, "No permission for this evidence");

  item.status = "completed";
  item.completedAt = nowIso();
  item.storageKey = String(input?.storageKey ?? `evidence/${item.evidenceId}`);
  item.fileName = String(input?.fileName ?? "");
  item.sizeBytes = Number.isFinite(Number(input?.sizeBytes)) ? Number(input.sizeBytes) : null;
  item.metadata = {
    ...(item.metadata ?? {}),
    ...(input?.metadata ?? {}),
  };

  appendEvent(room, {
    type: "evidence.upload.completed",
    actorId: actor.id,
    data: {
      evidenceId: item.evidenceId,
      storageKey: item.storageKey,
      sizeBytes: item.sizeBytes,
    },
  });

  return deepCopy(item);
}

export function joinRoom(roomId, input) {
  const room = requireRoom(roomId);
  assert(room.phase === Phase.LOBBY || room.phase === Phase.SUMMARY, "Join is allowed only in Lobby or Summary", 400);

  const name = String(input?.name ?? "Player").trim();
  const role = String(input?.role ?? Role.SEEKER).toLowerCase();
  const requestedPlayerId = String(input?.playerId ?? "").trim();
  const authenticatedUserId = String(input?.userId ?? "").trim() || null;
  assert(name.length >= 1 && name.length <= 32, "Player name must be 1-32 chars");
  assert(isRole(role), `Invalid role: ${role}`);

  if (requestedPlayerId) {
    const existing = room.players.find((item) => item.id === requestedPlayerId);
    if (existing) {
      if (existing.userId && authenticatedUserId && existing.userId !== authenticatedUserId) {
        assert(false, "Player belongs to a different authenticated user", 403);
      }
      if (existing.userId && !authenticatedUserId) {
        assert(false, "Authentication required for this player", 401);
      }
      if (!existing.userId && authenticatedUserId) {
        existing.userId = authenticatedUserId;
      }
      existing.name = name;
      if (existing.role !== role) {
        if (role === Role.HIDER) {
          const anotherHider = room.players.find((item) => item.role === Role.HIDER && item.id !== existing.id);
          assert(!anotherHider, "There is already a hider in this room");
        }
        existing.role = role;
      }
      return deepCopy(existing);
    }
  }

  if (role === Role.HIDER) {
    const existingHider = room.players.find((item) => item.role === Role.HIDER);
    assert(!existingHider, "There is already a hider in this room");
  }

  const player = {
    id: requestedPlayerId || newId("player"),
    userId: authenticatedUserId,
    name,
    role,
    ready: false,
    joinedAt: nowIso(),
    inTransit: false,
    hand: [],
    handLimitBonus: 0,
    activeCurses: [],
    locationTrail: [],
    lastLocation: null,
  };

  room.players.push(player);
  appendEvent(room, {
    type: "player.joined",
    actorId: player.id,
    data: {
      name: player.name,
      role: player.role,
    },
  });

  return deepCopy(player);
}

export function leaveRoom(roomId, input) {
  const room = requireRoom(roomId);
  const player = requirePlayer(room, input?.playerId);
  const playerIndex = room.players.findIndex((item) => item.id === player.id);
  assert(playerIndex >= 0, `Player not found in room: ${player.id}`, 404);

  room.players.splice(playerIndex, 1);

  appendEvent(room, {
    type: "player.left",
    actorId: player.id,
    data: {
      playerId: player.id,
      name: player.name,
      role: player.role,
      phase: room.phase,
    },
  });

  if (isRoomPhaseInteractive(room)) {
    const hiders = room.players.filter((item) => item.role === Role.HIDER);
    const seekers = room.players.filter((item) => item.role === Role.SEEKER);
    const hasValidRoundRoles = hiders.length === 1 && seekers.length >= 1;

    if (!hasValidRoundRoles) {
      const winner = hiders.length === 1 ? "hider" : "seekers";
      const reason = player.role === Role.HIDER
        ? "hider_left_room"
        : seekers.length === 0
          ? "all_seekers_left_room"
          : "roles_invalid_after_leave";

      finalizeSummary(room, {
        winner,
        reason,
        actorId: player.id,
      });
    }
  }

  return {
    roomId: room.id,
    playerId: player.id,
    left: true,
    phase: room.phase,
    remainingPlayers: room.players.length,
  };
}

export function setReady(roomId, input) {
  const room = requireRoom(roomId);
  assert(
    room.phase === Phase.LOBBY || room.phase === Phase.SUMMARY,
    "Ready can be changed only in Lobby or Summary",
    400,
  );
  const player = requirePlayer(room, input?.playerId);
  const ready = Boolean(input?.ready);
  player.ready = ready;

  appendEvent(room, {
    type: "player.ready.updated",
    actorId: player.id,
    data: {
      ready,
    },
  });

  if (room.phase === Phase.LOBBY && canStartRound(room)) {
    startRound(room, player.id, "auto_ready_check");
  }

  return {
    playerId: player.id,
    ready: player.ready,
    phase: room.phase,
  };
}

export function manualStartRound(roomId, input) {
  const room = requireRoom(roomId);
  assert(room.phase === Phase.LOBBY || room.phase === Phase.SUMMARY, "Round can be started only from Lobby or Summary");
  const actorId = input?.playerId ?? null;
  if (actorId) {
    requirePlayer(room, actorId);
  }

  room.players.forEach((player) => {
    if (player.role !== Role.OBSERVER) {
      player.ready = true;
    }
  });
  startRound(room, actorId, "manual_start");

  return {
    roomId: room.id,
    phase: room.phase,
    hideEndsAt: new Date(room.round.hideEndsAtMs).toISOString(),
  };
}

function debugAdvanceOnePhase(room, actorId, winner) {
  if (room.phase === Phase.LOBBY) {
    const activePlayers = room.players.filter((item) => item.role !== Role.OBSERVER);
    assert(
      activePlayers.length >= 2,
      "Debug advance from Lobby requires at least 2 non-observer players",
      400,
    );

    room.players.forEach((player) => {
      if (player.role !== Role.OBSERVER) {
        player.ready = true;
      }
    });
    assert(
      canStartRound(room),
      "Debug advance from Lobby requires exactly 1 hider and at least 1 seeker",
      400,
    );
    startRound(room, actorId, "debug_advance_phase");
    return;
  }

  if (room.phase === Phase.HIDE) {
    transitionToSeek(room, "debug_advance_phase");
    return;
  }

  if (room.phase === Phase.SEEK || room.phase === Phase.END_GAME || room.phase === Phase.CAUGHT) {
    finalizeSummary(room, {
      winner,
      reason: "debug_advance_phase",
      actorId,
    });
    return;
  }

  if (room.phase === Phase.SUMMARY) {
    nextRound(room.id, actorId ? { playerId: actorId } : {});
    return;
  }
}

export function debugAdvancePhase(roomId, input = {}) {
  const room = requireRoom(roomId);
  const actorId = String(input?.playerId ?? "").trim() || null;
  if (actorId) {
    requirePlayer(room, actorId);
  }

  const winner = String(input?.winner ?? "hider").trim().toLowerCase();
  assert(winner === "hider" || winner === "seekers", "winner must be 'hider' or 'seekers'");

  const parsedSteps = Number(input?.steps ?? 1);
  const steps = Number.isInteger(parsedSteps) ? parsedSteps : 1;
  assert(steps >= 1 && steps <= 4, "steps must be an integer between 1 and 4");

  for (let i = 0; i < steps; i += 1) {
    debugAdvanceOnePhase(room, actorId, winner);
  }

  return {
    roomId: room.id,
    phase: room.phase,
    roundNumber: room.round.number,
    stepsApplied: steps,
    hideEndsAt: room.round.hideEndsAtMs ? new Date(room.round.hideEndsAtMs).toISOString() : null,
    seekEndsAt: room.round.seekEndsAtMs ? new Date(room.round.seekEndsAtMs).toISOString() : null,
  };
}

export function setTransitStatus(roomId, input) {
  const room = requireRoom(roomId);
  const player = requirePlayer(room, input?.playerId);
  const inTransit = Boolean(input?.inTransit);
  player.inTransit = inTransit;
  const nearestStop = player.lastLocation
    ? findNearestTransitStop(room.transitPackId, player.lastLocation, 1200)
    : null;
  const transitLines = nearestStop
    ? getTransitPack(room.transitPackId)?.stopRouteIndex?.[nearestStop.stopId] ?? []
    : [];

  appendEvent(room, {
    type: "player.transit.updated",
    actorId: player.id,
    data: {
      inTransit,
      nearestStopId: nearestStop?.stopId ?? null,
      transitLines,
    },
  });

  if (player.role === Role.SEEKER) {
    tryEnterEndGame(room, player.id);
  }

  return {
    playerId: player.id,
    inTransit: player.inTransit,
    nearestStop,
    transitLines,
  };
}

export function pauseRound(roomId, input) {
  const room = requireRoom(roomId);
  const actor = input?.playerId ? requirePlayer(room, input.playerId) : null;
  return activatePause(room, actor?.id ?? null, String(input?.reason ?? "manual_pause"));
}

export function resumeRound(roomId, input) {
  const room = requireRoom(roomId);
  const actor = input?.playerId ? requirePlayer(room, input.playerId) : null;
  return deactivatePause(room, actor?.id ?? null, String(input?.reason ?? "manual_resume"));
}

export function createDispute(roomId, input) {
  const room = requireRoom(roomId);
  const actor = requirePlayer(room, input?.playerId);
  const requiredVoterIds = room.players
    .filter((item) => item.role !== Role.OBSERVER)
    .map((item) => item.id);
  const dispute = {
    id: newId("dispute"),
    type: String(input?.type ?? "generic"),
    status: "open",
    votePolicy: String(input?.votePolicy ?? "unanimous"),
    requiredVoterIds,
    votes: {},
    createdBy: actor.id,
    createdAt: nowIso(),
    description: String(input?.description ?? "").trim(),
    payload: input?.payload ?? {},
    resolution: null,
  };
  room.disputes.push(dispute);

  appendEvent(room, {
    type: "dispute.created",
    actorId: actor.id,
    data: {
      disputeId: dispute.id,
      type: dispute.type,
    },
  });

  if (Boolean(input?.autoPause ?? true)) {
    activatePause(room, actor.id, "dispute_opened");
  }

  return deepCopy(dispute);
}

export function voteDispute(roomId, input) {
  const room = requireRoom(roomId);
  const actor = requirePlayer(room, input?.playerId);
  const disputeId = String(input?.disputeId ?? "").trim();
  const dispute = room.disputes.find((item) => item.id === disputeId);
  assert(dispute, `Dispute not found: ${disputeId}`, 404);
  assert(dispute.status === "open", "Dispute already resolved", 400);
  assert(dispute.requiredVoterIds.includes(actor.id), "Actor is not eligible to vote this dispute", 403);

  const vote = String(input?.vote ?? "").toLowerCase();
  assert(vote === "accept" || vote === "reject", "vote must be accept or reject");
  dispute.votes[actor.id] = vote;

  appendEvent(room, {
    type: "dispute.voted",
    actorId: actor.id,
    data: {
      disputeId: dispute.id,
      vote,
      votesCollected: Object.keys(dispute.votes).length,
      votesRequired: dispute.requiredVoterIds.length,
    },
  });

  const votes = dispute.requiredVoterIds
    .map((playerId) => dispute.votes[playerId] ?? null);
  const hasReject = votes.some((item) => item === "reject");
  const allAccepted = votes.length > 0 && votes.every((item) => item === "accept");
  const allVoted = votes.every((item) => item !== null);

  if (!hasReject && !allAccepted) {
    return deepCopy({
      status: "open",
      dispute,
    });
  }

  dispute.status = "resolved";
  dispute.resolution = {
    decision: hasReject ? "rejected" : "accepted",
    note: hasReject
      ? "Vote rejected by at least one required voter"
      : "Unanimous acceptance",
    resolvedBy: actor.id,
    resolvedAt: nowIso(),
    mode: "vote",
  };

  if (dispute.type === "place_legitimacy" && dispute.payload?.placeId) {
    room.poiLegitimacyOverrides[dispute.payload.placeId] = dispute.resolution.decision === "accepted";
  }

  appendEvent(room, {
    type: "dispute.resolved",
    actorId: actor.id,
    data: {
      disputeId: dispute.id,
      decision: dispute.resolution.decision,
      byVote: true,
      allVoted,
    },
  });

  if (Boolean(input?.resumeAfterResolve ?? true)) {
    deactivatePause(room, actor.id, "dispute_vote_resolved");
  }

  return deepCopy({
    status: "resolved",
    dispute,
  });
}

export function resolveDispute(roomId, input) {
  const room = requireRoom(roomId);
  const actor = requirePlayer(room, input?.playerId);
  const disputeId = String(input?.disputeId ?? "");
  const dispute = room.disputes.find((item) => item.id === disputeId);
  assert(dispute, `Dispute not found: ${disputeId}`, 404);
  assert(dispute.status === "open", "Dispute already resolved", 400);

  dispute.status = "resolved";
  dispute.resolution = {
    decision: String(input?.decision ?? "accepted"),
    note: String(input?.note ?? "").trim(),
    resolvedBy: actor.id,
    resolvedAt: nowIso(),
  };

  if (dispute.type === "place_legitimacy" && dispute.payload?.placeId) {
    room.poiLegitimacyOverrides[dispute.payload.placeId] = dispute.resolution.decision === "accepted";
  }

  appendEvent(room, {
    type: "dispute.resolved",
    actorId: actor.id,
    data: {
      disputeId: dispute.id,
      decision: dispute.resolution.decision,
    },
  });

  if (Boolean(input?.resumeAfterResolve ?? true)) {
    deactivatePause(room, actor.id, "dispute_resolved");
  }

  return deepCopy(dispute);
}

export function updateLocation(roomId, input) {
  const room = requireRoom(roomId);
  const player = requirePlayer(room, input?.playerId);
  const lat = Number(input?.lat);
  const lng = Number(input?.lng);
  const accuracy = Number(input?.accuracy ?? 0);

  assert(Number.isFinite(lat) && Number.isFinite(lng), "lat and lng are required numbers");

  const tsMs = nowMs();
  const report = {
    lat,
    lng,
    accuracy,
    tsMs,
    ts: new Date(tsMs).toISOString(),
    signature: hash(`${room.id}|${player.id}|${lat}|${lng}|${tsMs}`),
  };

  const previous = player.lastLocation;
  const restrictions = buildRestrictionState(player, tsMs);
  if (room.phase === Phase.END_GAME && player.role === Role.HIDER && room.round.hiderFixedSpot) {
    const movedFromFixed = haversineMeters(room.round.hiderFixedSpot, report);
    assert(movedFromFixed <= 3, "Hider is fixed in End Game and cannot move away from final hiding spot");
  }
  if (previous && restrictions.movementLocked) {
    const movedMeters = haversineMeters(previous, report);
    if (movedMeters > room.rules.maxMovementWhenLockedMeters) {
      appendEvent(room, {
        type: "curse.movement_blocked",
        actorId: player.id,
        data: {
          movedMeters: Number(movedMeters.toFixed(2)),
          maxMovementWhenLockedMeters: room.rules.maxMovementWhenLockedMeters,
        },
      });
      assert(
        false,
        `Movement locked by curse. Max ${room.rules.maxMovementWhenLockedMeters}m per location update`,
      );
    }
  }

  player.lastLocation = report;
  player.locationTrail.push(report);

  if (player.locationTrail.length > 500) {
    player.locationTrail.shift();
  }

  appendEvent(room, {
    type: "location.updated",
    actorId: player.id,
    visibility: player.role === Role.SEEKER ? Visibility.HIDER : Visibility.OBSERVERS,
    data: {
      playerId: player.id,
      role: player.role,
      lat: report.lat,
      lng: report.lng,
      accuracy: report.accuracy,
      ts: report.ts,
      signature: report.signature,
    },
  });

  if (previous) {
    const deltaSec = (report.tsMs - previous.tsMs) / 1000;
    if (deltaSec > 0) {
      const distance = haversineMeters(previous, report);
      const speed = distance / deltaSec;
      if (speed > room.rules.teleportSpeedMpsThreshold) {
        appendEvent(room, {
          type: "fairplay.speed_anomaly",
          actorId: player.id,
          visibility: Visibility.OBSERVERS,
          data: {
            playerId: player.id,
            speedMps: Number(speed.toFixed(2)),
            threshold: room.rules.teleportSpeedMpsThreshold,
          },
        });
      }
    }
  }

  if (player.role === Role.SEEKER) {
    tryEnterEndGame(room, player.id);
  }

  return {
    playerId: player.id,
    updatedAt: report.ts,
    signature: report.signature,
  };
}

export function submitQuestion(roomId, input) {
  const room = requireRoom(roomId);
  assert(
    room.phase === Phase.SEEK || room.phase === Phase.END_GAME,
    "Questions are allowed only during Seek/EndGame phase",
  );
  assert(!isRoundPaused(room), "Round is paused");

  const player = requirePlayer(room, input?.playerId);
  assert(player.role === Role.SEEKER, "Only seekers can ask questions");
  if (room.rules.singlePendingQuestionOnly) {
    assert(!room.round.pendingQuestionId, "There is already a pending question waiting for answer");
  }

  const category = normalizeQuestionCategory(input?.category ?? "matching");
  assert(QUESTION_CATEGORIES.includes(category), `Unsupported question category: ${category}`);
  const restrictions = buildRestrictionState(player);
  assert(
    !restrictions.blockedQuestionCategories.includes(category),
    `Question category is blocked by curse: ${category}`,
  );
  const config = getQuestionConfig(category, room.scale);

  const currentMs = nowMs();
  const lastQuestion = getLastQuestionForPlayer(room, player.id);
  if (lastQuestion) {
    const lastAskedAtMs = questionAskedAtMs(lastQuestion);
    const cooldownSec = Math.max(0, Number(room.rules.questionCooldownSec));
    const elapsedSec = (currentMs - lastAskedAtMs) / 1000;
    assert(elapsedSec >= cooldownSec, `Question cooldown active. Wait ${Math.ceil(cooldownSec - elapsedSec)}s`);
  }

  const optionKey = input?.optionKey ?? input?.value ?? null;
  const questionKey = nowQuestionKey(category, optionKey);
  const repeatIndex = (room.round.questionRepeatCounts[questionKey] ?? 0) + 1;
  room.round.questionRepeatCounts[questionKey] = repeatIndex;

  const overrideCost = restrictions.questionCostOverrides?.[category] ?? {};
  const drawBase = Number(overrideCost.drawCount ?? config.drawCount);
  const keepBase = Number(overrideCost.keepCount ?? config.keepCount);
  const drawCount = Math.max(1, Math.floor(drawBase * repeatIndex));
  const keepCount = Math.max(1, Math.floor(keepBase * repeatIndex));
  const answerLimitSec = getQuestionAnswerLimitSec(category, room);
  const dueAtMs = currentMs + answerLimitSec * 1000;

  const question = {
    id: newId("q"),
    playerId: player.id,
    category,
    optionKey,
    key: questionKey,
    repeatIndex,
    prompt: String(input?.prompt ?? "").trim(),
    askedAtMs: currentMs,
    askedAt: nowIso(),
    dueAtMs,
    dueAt: new Date(dueAtMs).toISOString(),
    timedOut: false,
    status: "pending",
    reward: {
      drawCount,
      keepCount,
      eligible: true,
      skippedReason: null,
    },
    answered: false,
    metadata: input?.metadata ?? {},
  };

  assert(question.prompt.length > 0, "Question prompt is required");

  room.round.questions.push(question);
  room.round.pendingQuestionId = question.id;
  appendEvent(room, {
    type: "question.asked",
    actorId: player.id,
    data: question,
  });

  return deepCopy(question);
}

function drawCardsFromDeck(room, count) {
  const cards = [];
  for (let i = 0; i < count; i += 1) {
    ensureDeck(room);
    const top = room.deck.shift();
    cards.push({
      id: newId("card"),
      ...top,
      drawnAt: nowIso(),
    });
  }
  return cards;
}

function pushCardsToDiscard(room, cards) {
  for (const card of cards) {
    room.discard.push(sanitizeCardTemplate(card));
  }
}

function grantQuestionReward(room, hider, question) {
  const reward = question.reward ?? {};
  if (!reward.eligible) {
    appendEvent(room, {
      type: "question.reward.skipped",
      actorId: hider.id,
      data: {
        questionId: question.id,
        reason: reward.skippedReason ?? "not_eligible",
      },
    });
    return {
      granted: false,
      reason: reward.skippedReason ?? "not_eligible",
    };
  }

  const drawCount = Math.max(1, Number(reward.drawCount ?? 1));
  const keepCount = Math.max(1, Number(reward.keepCount ?? 1));
  const candidates = drawCardsFromDeck(room, drawCount);
  const handSpace = Math.max(0, getMaxHandLimit(room, hider) - hider.hand.length);

  appendEvent(room, {
    type: "card.drawn",
    actorId: hider.id,
    visibility: Visibility.HIDER,
    data: {
      source: "question_reward",
      questionId: question.id,
      count: candidates.length,
      cardIds: candidates.map((item) => item.id),
    },
  });

  if (handSpace <= 0) {
    pushCardsToDiscard(room, candidates);
    return {
      granted: false,
      reason: "hand_full",
      candidates: [],
      keepCount: 0,
    };
  }

  const requiredKeep = Math.min(keepCount, candidates.length, handSpace);
  if (requiredKeep === candidates.length) {
    hider.hand.push(...candidates);
    return {
      granted: true,
      autoKept: true,
      keptCardIds: candidates.map((item) => item.id),
      keepCount: requiredKeep,
      candidates: [],
    };
  }

  room.round.pendingRewardChoice = {
    id: newId("reward"),
    questionId: question.id,
    hiderId: hider.id,
    keepCount: requiredKeep,
    candidateCards: candidates,
    createdAt: nowIso(),
  };
  return {
    granted: true,
    autoKept: false,
    pendingRewardChoice: {
      id: room.round.pendingRewardChoice.id,
      questionId: room.round.pendingRewardChoice.questionId,
      keepCount: room.round.pendingRewardChoice.keepCount,
      candidateCardIds: room.round.pendingRewardChoice.candidateCards.map((item) => item.id),
    },
  };
}

export function chooseRewardCards(roomId, input) {
  const room = requireRoom(roomId);
  const player = requirePlayer(room, input?.playerId);
  const pending = room.round.pendingRewardChoice;
  assert(pending, "No pending reward choice", 400);
  assert(pending.hiderId === player.id, "Only hider can choose reward cards", 403);

  const keepIds = Array.isArray(input?.cardIds) ? input.cardIds.map(String) : [];
  const uniqueKeepIds = [...new Set(keepIds)];
  assert(
    uniqueKeepIds.length === pending.keepCount,
    `You must choose exactly ${pending.keepCount} cards`,
  );

  const candidateById = new Map(pending.candidateCards.map((item) => [item.id, item]));
  const kept = [];
  const discarded = [];

  for (const card of pending.candidateCards) {
    if (uniqueKeepIds.includes(card.id)) {
      kept.push(card);
    } else {
      discarded.push(card);
    }
  }

  assert(kept.length === pending.keepCount, "Invalid card selection", 400);
  const handSpace = Math.max(0, getMaxHandLimit(room, player) - player.hand.length);
  if (kept.length > handSpace) {
    const overflow = kept.splice(handSpace);
    discarded.push(...overflow);
  }

  player.hand.push(...kept);
  pushCardsToDiscard(room, discarded);
  room.round.pendingRewardChoice = null;

  appendEvent(room, {
    type: "question.reward.selected",
    actorId: player.id,
    visibility: Visibility.HIDER,
    data: {
      keptCardIds: kept.map((item) => item.id),
      discardedCardIds: discarded.map((item) => item.id),
    },
  });

  return {
    keptCardIds: kept.map((item) => item.id),
    discardedCardIds: discarded.map((item) => item.id),
  };
}

export function submitAnswer(roomId, input) {
  const room = requireRoom(roomId);
  assert(
    room.phase === Phase.SEEK || room.phase === Phase.END_GAME,
    "Answers are allowed only during Seek/EndGame phase",
  );

  const player = requirePlayer(room, input?.playerId);
  assert(player.role === Role.HIDER, "Only hider can answer questions");

  const questionId = String(input?.questionId ?? "").trim();
  if (room.rules.singlePendingQuestionOnly) {
    assert(room.round.pendingQuestionId === questionId, "This question is not the active pending question");
  }
  const question = room.round.questions.find((item) => item.id === questionId);
  assert(question, `Question not found: ${questionId}`, 404);
  assert(!question.answered, "Question already answered");
  const restrictions = buildRestrictionState(player);
  const blurEffect = restrictions.activeEffects.find((effect) => effect.effect?.kind === "answer_blur_once");
  const answeredAtMs = nowMs();
  const timedOut = Boolean(question.timedOut) || (question.dueAtMs ? answeredAtMs > question.dueAtMs : false);
  if (timedOut) {
    question.reward.eligible = false;
    question.reward.skippedReason = "answer_timeout";
  }

  let answerValue = input?.value ?? null;
  if (blurEffect && typeof answerValue === "string") {
    answerValue = `Blurred clue: ${answerValue.slice(0, 24)}...`;
  }

  const answer = {
    id: newId("ans"),
    questionId: question.id,
    playerId: player.id,
    kind: String(input?.kind ?? "text"),
    value: answerValue,
    answeredAtMs,
    answeredAt: new Date(answeredAtMs).toISOString(),
    autoVerified: Boolean(input?.autoVerified),
    blurredByCard: Boolean(blurEffect),
    timedOut,
  };

  question.answered = true;
  question.status = "answered";
  room.round.answers.push(answer);
  room.round.pendingQuestionId = null;

  if (blurEffect) {
    player.activeCurses = player.activeCurses.filter((effect) => effect.id !== blurEffect.id);
    appendEvent(room, {
      type: "card.effect.consumed",
      actorId: player.id,
      visibility: Visibility.HIDER,
      data: {
        effectId: blurEffect.id,
        kind: "answer_blur_once",
      },
    });
  }

  appendEvent(room, {
    type: "question.answered",
    actorId: player.id,
    data: answer,
  });
  const rewardResult = grantQuestionReward(room, player, question);

  if (isRoundPaused(room) && room.pause.reason === "answer_timeout") {
    deactivatePause(room, player.id, "answer_submitted_after_timeout");
  }

  return deepCopy({
    answer,
    reward: rewardResult,
  });
}

export function addMapAnnotation(roomId, input) {
  const room = requireRoom(roomId);
  const player = requirePlayer(room, input?.playerId);
  assert(player.role === Role.SEEKER, "Only seekers can add map annotations");
  const restrictions = buildRestrictionState(player);

  const annotation = {
    id: newId("ann"),
    playerId: player.id,
    layer: String(input?.layer ?? "possible_area"),
    geometryType: String(input?.geometryType ?? "polygon"),
    geometry: input?.geometry ?? null,
    label: String(input?.label ?? "").trim(),
    sourceQuestionId: input?.sourceQuestionId ?? null,
    createdAt: nowIso(),
  };
  if (restrictions.mapCircleOnly) {
    assert(
      annotation.geometryType === "circle",
      "Map tools are restricted by curse. Only circle geometry is allowed",
    );
  }

  room.mapAnnotations.push(annotation);
  appendEvent(room, {
    type: "map.annotation.added",
    actorId: player.id,
    visibility: Visibility.SEEKERS,
    data: {
      annotationId: annotation.id,
      playerId: annotation.playerId,
      layer: annotation.layer,
      geometryType: annotation.geometryType,
      geometry: annotation.geometry,
      label: annotation.label,
      sourceQuestionId: annotation.sourceQuestionId,
      createdAt: annotation.createdAt,
    },
  });

  return deepCopy(annotation);
}

export function drawCards(roomId, input) {
  const room = requireRoom(roomId);
  const player = requirePlayer(room, input?.playerId);
  assert(player.role === Role.HIDER, "Only hider can draw cards");

  const drawCount = Math.max(1, Math.min(8, Number(input?.count ?? 1)));
  ensureDeck(room);

  const handLimit = getMaxHandLimit(room, player);
  assert(player.hand.length < handLimit, "Hand is already full");

  const maxDrawable = Math.max(0, handLimit - player.hand.length);
  const actualCount = Math.min(drawCount, maxDrawable);
  const drawn = [];

  for (let i = 0; i < actualCount; i += 1) {
    ensureDeck(room);
    const top = room.deck.shift();
    const card = {
      id: newId("card"),
      ...top,
      drawnAt: nowIso(),
    };
    player.hand.push(card);
    drawn.push(card);
  }

  appendEvent(room, {
    type: "card.drawn",
    actorId: player.id,
    visibility: Visibility.HIDER,
    data: {
      count: drawn.length,
      cardIds: drawn.map((item) => item.id),
    },
  });

  return deepCopy(drawn);
}

export function castCard(roomId, input) {
  const room = requireRoom(roomId);
  const player = requirePlayer(room, input?.playerId);
  assert(player.role === Role.HIDER, "Only hider can cast card");
  assert(
    room.phase === Phase.SEEK || room.phase === Phase.END_GAME,
    "Cards can be cast only during Seek/EndGame",
  );

  const targetId = input?.targetPlayerId ?? player.id;
  const target = requirePlayer(room, targetId);
  const cardId = String(input?.cardId ?? "");
  const idx = player.hand.findIndex((item) => item.id === cardId);
  assert(idx >= 0, `Card not found in hand: ${cardId}`, 404);

  const [card] = player.hand.splice(idx, 1);
  const now = nowMs();

  if (card.type === "time_bonus_fixed") {
    player.hand.push(card);
    assert(false, "Time bonus cards are scored at Caught and cannot be cast");
  }

  room.discard.push(sanitizeCardTemplate(card));

  if (card.type === "powerup") {
    const kind = card.effect?.kind;
    const result = {
      cardId: card.id,
      powerupKind: kind,
    };

    if (kind === "veto_pending_question") {
      const pending = room.round.questions.find((item) => item.id === room.round.pendingQuestionId);
      assert(pending, "No pending question to veto");
      pending.status = "vetoed";
      pending.reward.eligible = false;
      pending.reward.skippedReason = "vetoed";
      pending.answered = true;
      room.round.pendingQuestionId = null;
      appendEvent(room, {
        type: "question.vetoed",
        actorId: player.id,
        data: {
          questionId: pending.id,
        },
      });
      return deepCopy(result);
    }

    if (kind === "randomize_pending_question") {
      const pending = room.round.questions.find((item) => item.id === room.round.pendingQuestionId);
      assert(pending, "No pending question to randomize");
      const before = pending.optionKey;
      pending.optionKey = pickRandomOption(pending.category, room, pending.optionKey);
      pending.metadata = {
        ...(pending.metadata ?? {}),
        randomizedByCard: true,
        randomizedAt: nowIso(),
      };
      appendEvent(room, {
        type: "question.randomized",
        actorId: player.id,
        data: {
          questionId: pending.id,
          before,
          after: pending.optionKey,
        },
      });
      return deepCopy({
        ...result,
        questionId: pending.id,
        before,
        after: pending.optionKey,
      });
    }

    if (kind === "discard_draw") {
      const discardCount = Math.max(0, Number(card.effect.discardCount ?? 0));
      const drawCount = Math.max(1, Number(card.effect.drawCount ?? 1));
      const discardCardIds = Array.isArray(input?.discardCardIds) ? input.discardCardIds.map(String) : [];
      assert(discardCardIds.length === discardCount, `Must discard exactly ${discardCount} cards`);
      const unique = [...new Set(discardCardIds)];
      assert(unique.length === discardCount, "Duplicate discard card IDs are not allowed");

      const discarded = [];
      for (const discardId of unique) {
        const discardIdx = player.hand.findIndex((item) => item.id === discardId);
        assert(discardIdx >= 0, `Discard card not found in hand: ${discardId}`);
        const [discardCard] = player.hand.splice(discardIdx, 1);
        discarded.push(discardCard);
      }
      pushCardsToDiscard(room, discarded);

      const space = Math.max(0, getMaxHandLimit(room, player) - player.hand.length);
      const toDraw = Math.min(drawCount, space);
      const drawn = drawCardsFromDeck(room, toDraw);
      player.hand.push(...drawn);
      appendEvent(room, {
        type: "powerup.discard_draw.resolved",
        actorId: player.id,
        visibility: Visibility.HIDER,
        data: {
          discardedCardIds: discarded.map((item) => item.id),
          drawnCardIds: drawn.map((item) => item.id),
          drawCountRequested: drawCount,
          drawCountActual: drawn.length,
        },
      });
      return deepCopy({
        ...result,
        discardedCardIds: discarded.map((item) => item.id),
        drawnCardIds: drawn.map((item) => item.id),
      });
    }

    if (kind === "expand_hand_limit") {
      const increment = Math.max(0, Number(card.effect.increment ?? 1));
      player.handLimitBonus = Math.max(0, Number(player.handLimitBonus ?? 0) + increment);
      appendEvent(room, {
        type: "powerup.hand_limit_expanded",
        actorId: player.id,
        visibility: Visibility.HIDER,
        data: {
          increment,
          newMaxHandLimit: getMaxHandLimit(room, player),
        },
      });
      return deepCopy({
        ...result,
        increment,
        newMaxHandLimit: getMaxHandLimit(room, player),
      });
    }

    assert(false, `Unsupported powerup effect: ${kind}`);
  }

  if (card.type === "hider_buff") {
    assert(target.id === player.id, "Hider buff cards must target the hider");
  }
  if (card.type === "curse") {
    assert(target.role === Role.SEEKER, "Curse cards can only target seekers");
    const exists = target.activeCurses.some((item) => item.sourceTemplateId === card.templateId);
    assert(!exists, `Curse already active on target: ${card.templateId}`);
  }

  const appliedEffect = {
    id: newId("curse"),
    sourceTemplateId: card.templateId,
    sourceCardId: card.id,
    sourcePlayerId: player.id,
    targetPlayerId: target.id,
    effect: card.effect,
    startedAt: nowIso(),
    expiresAtMs: now + (card.effect.durationSec ?? 0) * 1000,
  };

  target.activeCurses.push(appliedEffect);

  appendEvent(room, {
    type: "card.cast",
    actorId: player.id,
    data: {
      cardId: card.id,
      targetPlayerId: target.id,
      effect: card.effect,
    },
  });

  return deepCopy(appliedEffect);
}

export function castCurse(roomId, input) {
  const room = requireRoom(roomId);
  const player = requirePlayer(room, input?.playerId);
  const cardId = String(input?.cardId ?? "").trim();
  const card = player.hand.find((item) => item.id === cardId);
  assert(card, `Card not found in hand: ${cardId}`, 404);
  assert(card.type === "curse", "castCurse requires a curse card");
  return castCard(roomId, input);
}

export function rollDice(roomId, input) {
  const room = requireRoom(roomId);
  const player = requirePlayer(room, input?.playerId);
  const sides = Math.max(2, Math.min(100, Number(input?.sides ?? 6)));
  const count = Math.max(1, Math.min(5, Number(input?.count ?? 1)));
  const purpose = String(input?.purpose ?? "generic").slice(0, 100);

  const results = [];
  for (let i = 0; i < count; i += 1) {
    results.push(randomIntInclusive(1, sides));
  }

  const nonce = newId("nonce");
  const proof = hash(`${room.id}|${player.id}|${purpose}|${results.join(",")}|${nonce}|${nowIso()}`);

  const roll = {
    id: newId("roll"),
    playerId: player.id,
    sides,
    count,
    purpose,
    results,
    nonce,
    proof,
    rolledAt: nowIso(),
  };

  appendEvent(room, {
    type: "dice.rolled",
    actorId: player.id,
    data: roll,
  });

  return deepCopy(roll);
}

export function postClue(roomId, input) {
  const room = requireRoom(roomId);
  assert(
    room.phase === Phase.SEEK || room.phase === Phase.END_GAME,
    "Clues can be shared only during Seek/EndGame phase",
  );
  assert(!isRoundPaused(room), "Round is paused");
  const player = requirePlayer(room, input?.playerId);
  assert(player.role === Role.HIDER, "Only hider can share clues");

  const clueText = String(input?.text ?? "").trim();
  assert(clueText.length > 0 && clueText.length <= 280, "Clue text must be 1-280 chars");

  const elapsedSec = seekElapsedSec(room);
  const unlockSec = Math.max(0, Number(room.rules.hiderClueUnlockAfterSec));
  assert(
    elapsedSec >= unlockSec,
    `Clue can be shared after ${unlockSec}s of Seek. Current elapsed: ${elapsedSec}s`,
  );

  const clue = {
    id: newId("clue"),
    playerId: player.id,
    text: clueText,
    createdAtMs: nowMs(),
    createdAt: nowIso(),
  };
  room.round.clues.push(clue);

  appendEvent(room, {
    type: "clue.shared",
    actorId: player.id,
    data: clue,
  });

  return deepCopy(clue);
}

export function claimCatch(roomId, input) {
  const room = requireRoom(roomId);
  assert(
    room.phase === Phase.SEEK || room.phase === Phase.END_GAME,
    "Catch claim can be started only during Seek/EndGame",
  );
  assert(!isRoundPaused(room), "Round is paused");

  const player = requirePlayer(room, input?.playerId);
  assert(player.role === Role.SEEKER, "Only seeker can claim catch");
  const target = requirePlayer(room, input?.targetPlayerId);
  assert(target.role === Role.HIDER, "Catch target must be the hider");

  const claim = {
    id: newId("claim"),
    seekerId: player.id,
    hiderId: target.id,
    method: String(input?.method ?? "distance"),
    visualConfirmed: Boolean(input?.visualConfirmed ?? false),
    details: input?.details ?? {},
    previousPhase: room.phase,
    claimedAtMs: nowMs(),
    claimedAt: nowIso(),
    expiresAtMs: nowMs() + room.rules.catchResponseWindowSec * 1000,
  };
  assert(claim.visualConfirmed, "Catch claim requires visual confirmation");

  room.phase = Phase.CAUGHT;
  room.round.pendingCatchClaim = claim;

  appendEvent(room, {
    type: "catch.claimed",
    actorId: player.id,
    data: claim,
  });

  if (claim.method === "distance") {
    const evaluation = evaluateDistanceCatch(room, claim);
    if (evaluation.canAutoResolve) {
      appendEvent(room, {
        type: "catch.auto_evaluated",
        actorId: player.id,
        data: {
          claimId: claim.id,
          ...evaluation,
        },
      });

      appendEvent(room, {
        type: "catch.resolved",
        actorId: player.id,
        data: {
          claimId: claim.id,
          result: evaluation.success ? "success" : "failed",
          reason: evaluation.reason,
        },
      });

      if (evaluation.success) {
        finalizeSummary(room, {
          winner: "seekers",
          reason: "catch_success_distance_auto",
          actorId: player.id,
        });
        return deepCopy({
          ...claim,
          autoResolved: true,
          result: "success",
          evaluation,
          summary: room.round.summary,
        });
      }

      const failedState = applyFailedCatchPenalty(
        room,
        player.id,
        "distance_auto_failed",
        evaluation.metrics,
      );
      return deepCopy({
        ...claim,
        autoResolved: true,
        result: "failed",
        evaluation,
        state: failedState,
      });
    }
  }

  return deepCopy({ ...claim, autoResolved: false });
}

export function resolveCatch(roomId, input) {
  const room = requireRoom(roomId);
  assert(room.phase === Phase.CAUGHT, "No active catch claim to resolve");
  assert(room.round.pendingCatchClaim, "No catch claim found", 404);

  const actor = requirePlayer(room, input?.playerId);
  assert(
    actor.role === Role.HIDER || actor.role === Role.OBSERVER,
    "Only hider or observer can resolve a pending catch claim",
  );
  const result = String(input?.result ?? "failed").toLowerCase();
  assert(result === "success" || result === "failed", "result must be success or failed");

  const claim = room.round.pendingCatchClaim;
  if (input?.claimId) {
    const expectedClaimId = String(input.claimId);
    assert(expectedClaimId === claim.id, `Claim mismatch: expected ${claim.id}, got ${expectedClaimId}`);
  }

  appendEvent(room, {
    type: "catch.resolved",
    actorId: actor.id,
    data: {
      claimId: claim.id,
      result,
      reason: input?.reason ?? null,
    },
  });

  if (result === "success") {
    finalizeSummary(room, {
      winner: "seekers",
      reason: "catch_success",
      actorId: actor.id,
    });
    return {
      phase: room.phase,
      summary: room.round.summary,
    };
  }

  return applyFailedCatchPenalty(room, actor.id, "manual_resolve_failed", {
    reason: input?.reason ?? null,
  });
}

export function nextRound(roomId, input) {
  const room = requireRoom(roomId);
  assert(room.phase === Phase.SUMMARY, "next-round can be called only in Summary");
  if (input?.playerId) {
    requirePlayer(room, input.playerId);
  }

  rotateRoles(room);
  clearRoundState(room);
  room.phase = Phase.LOBBY;
  room.pause = {
    isPaused: false,
    pausedAtMs: null,
    reason: null,
  };
  room.disputes = room.disputes.filter((item) => item.status !== "open");
  room.players.forEach((player) => {
    player.ready = false;
    player.inTransit = false;
    player.activeCurses = player.activeCurses.filter((effect) => effect.expiresAtMs > nowMs());
  });

  appendEvent(room, {
    type: "round.prepared",
    actorId: input?.playerId ?? null,
    data: {
      nextRoundNumber: room.round.number + 1,
    },
  });

  return {
    roomId: room.id,
    phase: room.phase,
    nextRoundNumber: room.round.number + 1,
  };
}

export function projectRoom(roomId, playerId) {
  const room = requireRoom(roomId);
  const viewer = requirePlayer(room, playerId);
  const capabilities = buildPlayerCapabilities(room, viewer);
  const allowedActions = buildAllowedActions(capabilities);
  const pendingQuestion = room.round.questions.find((item) => item.id === room.round.pendingQuestionId) ?? null;
  const pendingRewardChoice =
    viewer.role === Role.HIDER || viewer.role === Role.OBSERVER ? room.round.pendingRewardChoice : null;

  const response = {
    id: room.id,
    name: room.name,
    scale: room.scale,
    mode: room.mode,
    mapProvider: room.mapProvider,
    mapSource: room.mapSource,
    transitPackId: room.transitPackId,
    expansionEnabled: room.expansionEnabled,
    config: room.config,
    phase: room.phase,
    paused: room.pause,
    rules: room.rules,
    round: {
      number: room.round.number,
      hideEndsAt: room.round.hideEndsAtMs ? new Date(room.round.hideEndsAtMs).toISOString() : null,
      seekEndsAt: room.round.seekEndsAtMs ? new Date(room.round.seekEndsAtMs).toISOString() : null,
      endGameStartedAt: room.round.endGameStartedAtMs ? new Date(room.round.endGameStartedAtMs).toISOString() : null,
      hidingZone: room.round.hidingZone,
      hiderFixedSpot:
        viewer.role === Role.OBSERVER
          ? room.round.hiderFixedSpot
          : viewer.role === Role.HIDER
            ? room.round.hiderFixedSpot
            : null,
      pendingQuestion,
      pendingRewardChoice,
      pendingCatchClaim: room.round.pendingCatchClaim,
      summary: room.round.summary,
      seekDurationSecCurrent: computeSeekDurationSec(room),
      clues: room.round.clues ?? [],
    },
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      role: player.role,
      ready: player.ready,
      inTransit: player.inTransit,
      activeCurses: player.id === viewer.id || viewer.role === Role.OBSERVER ? player.activeCurses : undefined,
      location: projectedLocation(viewer.role, player, room),
    })),
    mapAnnotations: viewer.role === Role.HIDER ? [] : room.mapAnnotations,
    events: projectEvents(room, viewer.role),
    hand: viewer.hand,
    capabilities,
    allowedActions,
    disputes: room.disputes,
    evidence: room.evidence,
    gameEndsAt: room.gameEndsAtMs ? new Date(room.gameEndsAtMs).toISOString() : null,
    scores: room.scores,
  };

  return deepCopy(response);
}

export function getRoundActionState(roomId, playerId) {
  const room = requireRoom(roomId);
  const player = requirePlayer(room, playerId);
  const capabilities = buildPlayerCapabilities(room, player);
  return {
    roomId: room.id,
    playerId: player.id,
    capabilities: deepCopy(capabilities),
    allowedActions: buildAllowedActions(capabilities),
  };
}

export function executeRoundAction(roomId, action, input = {}) {
  const room = requireRoom(roomId);
  const actor = requirePlayer(room, input?.playerId);
  const normalizedAction = String(action ?? "").trim();
  assertRoundActionAllowed(room, actor, normalizedAction);

  let result;
  switch (normalizedAction) {
    case RoundAction.ASK:
      result = submitQuestion(room.id, input);
      break;
    case RoundAction.ANSWER:
      result = submitAnswer(room.id, input);
      break;
    case RoundAction.DRAW_CARD:
      result = drawCards(room.id, input);
      break;
    case RoundAction.CAST_CURSE:
      result = castCurse(room.id, input);
      break;
    case RoundAction.ROLL_DICE:
      result = rollDice(room.id, input);
      break;
    case RoundAction.CLAIM_CATCH:
      result = claimCatch(room.id, input);
      break;
    default:
      assert(false, `Unsupported round action: ${normalizedAction}`, 400);
  }

  const projection = projectRoom(room.id, actor.id);
  const cursorInfo = getRoomCursor(room.id);
  return deepCopy({
    roomId: room.id,
    roomCode: cursorInfo.roomCode,
    cursor: cursorInfo.cursor,
    action: normalizedAction,
    result,
    projection,
    capabilities: projection.capabilities,
    allowedActions: projection.allowedActions ?? [],
  });
}

export function tick(now = nowMs()) {
  for (const room of rooms.values()) {
    if (!isRoundPaused(room)) {
      if (room.gameEndsAtMs && now >= room.gameEndsAtMs && room.phase !== Phase.SUMMARY) {
        finalizeSummary(room, {
          winner: "hider",
          reason: "global_timer_elapsed",
        });
        continue;
      }

      if (room.phase === Phase.HIDE && room.round.hideEndsAtMs && now >= room.round.hideEndsAtMs) {
        transitionToSeek(room, "hide_timer_elapsed");
        continue;
      }

      if (
        (room.phase === Phase.SEEK || room.phase === Phase.END_GAME) &&
        room.round.seekEndsAtMs &&
        now >= room.round.seekEndsAtMs
      ) {
        finalizeSummary(room, {
          winner: "hider",
          reason: "seek_timer_elapsed",
        });
        continue;
      }

      if (room.phase === Phase.SEEK && room.round.hidingZone?.center) {
        for (const seeker of room.players.filter((item) => item.role === Role.SEEKER)) {
          if (tryEnterEndGame(room, seeker.id)) {
            break;
          }
        }
      }

      const pendingQuestion = room.round.questions.find((item) => item.id === room.round.pendingQuestionId);
      if (
        pendingQuestion &&
        !pendingQuestion.answered &&
        !pendingQuestion.timedOut &&
        pendingQuestion.dueAtMs &&
        now >= pendingQuestion.dueAtMs
      ) {
        pendingQuestion.timedOut = true;
        pendingQuestion.reward.eligible = false;
        pendingQuestion.reward.skippedReason = "answer_timeout";
        appendEvent(room, {
          type: "question.timeout",
          data: {
            questionId: pendingQuestion.id,
            dueAt: pendingQuestion.dueAt,
          },
        });
        if (room.rules.autoPauseOnAnswerTimeout) {
          activatePause(room, null, "answer_timeout");
        }
      }

      if (
        room.phase === Phase.CAUGHT &&
        room.round.pendingCatchClaim &&
        now >= room.round.pendingCatchClaim.expiresAtMs
      ) {
        appendEvent(room, {
          type: "catch.timeout_auto_failed",
          data: {
            claimId: room.round.pendingCatchClaim.id,
          },
        });
        applyFailedCatchPenalty(room, null, "catch_response_timeout");
      }
    }

    for (const player of room.players) {
      if (!player.activeCurses?.length) {
        continue;
      }
      const before = player.activeCurses.length;
      player.activeCurses = player.activeCurses.filter((effect) => effect.expiresAtMs > now);
      if (before !== player.activeCurses.length) {
        appendEvent(room, {
          type: "curse.expired",
          actorId: player.id,
          data: {
            remaining: player.activeCurses.length,
          },
        });
      }
    }
  }
}
