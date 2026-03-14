export const Phase = Object.freeze({
  LOBBY: "Lobby",
  HIDE: "Hide",
  SEEK: "Seek",
  END_GAME: "EndGame",
  CAUGHT: "Caught",
  SUMMARY: "Summary",
});

export const Role = Object.freeze({
  HIDER: "hider",
  SEEKER: "seeker",
  OBSERVER: "observer",
});

export const Visibility = Object.freeze({
  PUBLIC: "public",
  HIDER: "hider",
  SEEKERS: "seekers",
  OBSERVERS: "observers",
});

export const GameScale = Object.freeze({
  SMALL: "small",
  MEDIUM: "medium",
  LARGE: "large",
});

export const SCALE_PRESETS = Object.freeze({
  [GameScale.SMALL]: Object.freeze({
    hideDurationSec: 30 * 60,
    hidingZoneRadiusMeters: 500,
    photoAnswerLimitSec: 10 * 60,
    thermometerDistanceOptionsMeters: Object.freeze([1000, 5000]),
    tentaclesEnabled: false,
  }),
  [GameScale.MEDIUM]: Object.freeze({
    hideDurationSec: 60 * 60,
    hidingZoneRadiusMeters: 500,
    photoAnswerLimitSec: 10 * 60,
    thermometerDistanceOptionsMeters: Object.freeze([1000, 5000, 15000]),
    tentaclesEnabled: true,
  }),
  [GameScale.LARGE]: Object.freeze({
    hideDurationSec: 180 * 60,
    hidingZoneRadiusMeters: 1000,
    photoAnswerLimitSec: 20 * 60,
    thermometerDistanceOptionsMeters: Object.freeze([1000, 5000, 15000, 75000]),
    tentaclesEnabled: true,
  }),
});

export const QUESTION_CATEGORIES = Object.freeze([
  "matching",
  "measuring",
  "radar",
  "thermometer",
  "photo",
  "tentacles",
]);

export const QUESTION_CATEGORY_CONFIG = Object.freeze({
  matching: Object.freeze({
    drawCount: 3,
    keepCount: 1,
    answerLimitSec: 5 * 60,
    scales: [GameScale.SMALL, GameScale.MEDIUM, GameScale.LARGE],
  }),
  measuring: Object.freeze({
    drawCount: 3,
    keepCount: 1,
    answerLimitSec: 5 * 60,
    scales: [GameScale.SMALL, GameScale.MEDIUM, GameScale.LARGE],
  }),
  radar: Object.freeze({
    drawCount: 2,
    keepCount: 1,
    answerLimitSec: 5 * 60,
    scales: [GameScale.SMALL, GameScale.MEDIUM, GameScale.LARGE],
  }),
  thermometer: Object.freeze({
    drawCount: 2,
    keepCount: 1,
    answerLimitSec: 5 * 60,
    scales: [GameScale.SMALL, GameScale.MEDIUM, GameScale.LARGE],
  }),
  photo: Object.freeze({
    drawCount: 1,
    keepCount: 1,
    answerLimitSec: 10 * 60,
    scales: [GameScale.SMALL, GameScale.MEDIUM, GameScale.LARGE],
  }),
  tentacles: Object.freeze({
    drawCount: 4,
    keepCount: 2,
    answerLimitSec: 5 * 60,
    scales: [GameScale.MEDIUM, GameScale.LARGE],
  }),
});

export const RADAR_DISTANCE_OPTIONS_METERS = Object.freeze([
  500,
  1000,
  2000,
  5000,
  10000,
  15000,
  40000,
  80000,
  160000,
]);

export const TENTACLES_OPTIONS_BY_SCALE = Object.freeze({
  [GameScale.MEDIUM]: Object.freeze({
    radiusOptionsMeters: Object.freeze([2000]),
    categories: Object.freeze(["museum", "library", "movie_theater", "hospital"]),
  }),
  [GameScale.LARGE]: Object.freeze({
    radiusOptionsMeters: Object.freeze([2000, 25000]),
    categories: Object.freeze([
      "museum",
      "library",
      "movie_theater",
      "hospital",
      "metro_line",
      "zoo",
      "aquarium",
      "amusement_park",
    ]),
  }),
});

export const DEFAULT_RULES = Object.freeze({
  seekDurationSec: 8 * 60 * 60,
  questionCooldownSec: 0,
  singlePendingQuestionOnly: true,
  catchResponseWindowSec: 30,
  catchDistanceMeters: 2,
  catchHoldSeconds: 0,
  catchMaxReportAgeSec: 20,
  failedCatchPenaltyMode: "extra_time",
  failedCatchPenaltySec: 60,
  handLimit: 6,
  maxMovementWhenLockedMeters: 25,
  teleportSpeedMpsThreshold: 80,
  hiderClueUnlockAfterSec: 10 * 60,
  revealHiderPathInSummary: false,
  roleRotationMode: "sequential",
  prepWindowSec: 10 * 60,
  allowStreetView: false,
  mapProvider: "GOOGLE",
  mapSource: "GOOGLE",
  totalGameDurationSec: null,
  autoPauseOnAnswerTimeout: true,
});

export const DEFAULT_DECK = Object.freeze([
  {
    templateId: "tb_plus_5",
    name: "Time Bonus +5m",
    type: "time_bonus_fixed",
    effect: { kind: "time_bonus_fixed", minutes: 5 },
  },
  {
    templateId: "tb_plus_10",
    name: "Time Bonus +10m",
    type: "time_bonus_fixed",
    effect: { kind: "time_bonus_fixed", minutes: 10 },
  },
  {
    templateId: "powerup_veto",
    name: "Veto",
    type: "powerup",
    effect: { kind: "veto_pending_question" },
  },
  {
    templateId: "powerup_randomize",
    name: "Randomize",
    type: "powerup",
    effect: { kind: "randomize_pending_question" },
  },
  {
    templateId: "powerup_discard1_draw2",
    name: "Discard 1 Draw 2",
    type: "powerup",
    effect: { kind: "discard_draw", discardCount: 1, drawCount: 2 },
  },
  {
    templateId: "powerup_discard2_draw3",
    name: "Discard 2 Draw 3",
    type: "powerup",
    effect: { kind: "discard_draw", discardCount: 2, drawCount: 3 },
  },
  {
    templateId: "powerup_discard3_draw4",
    name: "Discard 3 Draw 4",
    type: "powerup",
    effect: { kind: "discard_draw", discardCount: 3, drawCount: 4 },
  },
  {
    templateId: "powerup_expand_hand_1",
    name: "Expand Hand Size +1",
    type: "powerup",
    effect: { kind: "expand_hand_limit", increment: 1 },
  },
  {
    templateId: "curse_overflowing_chalice",
    name: "Curse: Overflowing Chalice",
    type: "curse",
    effect: {
      kind: "question_cost_override",
      durationSec: 15 * 60,
      overrides: {
        matching: { drawCount: 4, keepCount: 1 },
        measuring: { drawCount: 4, keepCount: 1 },
        thermometer: { drawCount: 3, keepCount: 1 },
        radar: { drawCount: 3, keepCount: 1 },
        photo: { drawCount: 2, keepCount: 1 },
        tentacles: { drawCount: 5, keepCount: 2 },
      },
    },
  },
  {
    templateId: "curse_no_matching",
    name: "Curse: Silence Matching",
    type: "curse",
    effect: {
      kind: "question_category_ban",
      category: "matching",
      durationSec: 240,
    },
  },
  {
    templateId: "curse_map_circle_only",
    name: "Curse: Circle Only",
    type: "curse",
    effect: {
      kind: "map_tool_limit",
      mode: "circle_only",
      durationSec: 300,
    },
  },
  {
    templateId: "curse_stay_put",
    name: "Curse: Stay Put",
    type: "curse",
    effect: {
      kind: "movement_lock",
      durationSec: 120,
    },
  },
  {
    templateId: "hide_blur_next_answer",
    name: "Trick: Blur Next Answer",
    type: "hider_buff",
    effect: {
      kind: "answer_blur_once",
      durationSec: 9999,
    },
  },
]);
