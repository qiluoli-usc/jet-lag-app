import type {
  PendingQuestionProjection,
  ProjectionPlayer,
  RoomProjection,
  RoundAction,
} from "../types";

export const ACTION_CAPABILITY_KEY: Record<RoundAction, string> = {
  ask: "canAskQuestion",
  answer: "canAnswerQuestion",
  drawCard: "canDrawCard",
  castCurse: "canCastCard",
  rollDice: "canRollDice",
  claimCatch: "canClaimCatch",
};

function normalizePhaseValue(value: unknown): string {
  const phase = String(value ?? "").toUpperCase();

  if (phase === "HIDE" || phase === "HIDING") {
    return "HIDING";
  }
  if (phase === "SEEK" || phase === "SEEKING" || phase === "ENDGAME" || phase === "END_GAME" || phase === "CAUGHT") {
    return "SEEKING";
  }
  if (phase === "SUMMARY") {
    return "SUMMARY";
  }
  return "LOBBY";
}

export function normalizeProjection(input: RoomProjection | null | undefined): RoomProjection {
  const projection = input ?? {};
  const phase = normalizePhaseValue(projection.round?.phase ?? projection.phase);

  return {
    ...projection,
    phase,
    round: {
      ...(projection.round ?? {}),
      phase,
    },
    counters: {
      total: Number(projection.counters?.total ?? 0),
      byType: {
        ...(projection.counters?.byType ?? {}),
      },
    },
  };
}

function playerFromUnknown(id: string, value: unknown): ProjectionPlayer {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const normalizedId =
    (typeof row.id === "string" && row.id.length > 0 && row.id) ||
    (typeof row.playerId === "string" && row.playerId.length > 0 && row.playerId) ||
    id;

  return {
    id: normalizedId,
    name: typeof row.name === "string" ? row.name : undefined,
    role: typeof row.role === "string" ? (row.role as ProjectionPlayer["role"]) : undefined,
    ready: Boolean(row.ready),
    inTransit: Boolean(row.inTransit),
    location:
      row.location && typeof row.location === "object"
        ? (row.location as Record<string, unknown>)
        : null,
    ...row,
  };
}

export function getProjectionPlayers(projection: RoomProjection | null): ProjectionPlayer[] {
  const raw = projection?.players;
  if (Array.isArray(raw)) {
    return raw
      .filter((item) => item && typeof item === "object")
      .map((item, index) => {
        const row = item as ProjectionPlayer;
        const id = typeof row.id === "string" && row.id.length > 0
          ? row.id
          : `player_${index}`;
        return {
          ...row,
          id,
        };
      });
  }

  if (raw && typeof raw === "object") {
    return Object.entries(raw).map(([id, value]) => playerFromUnknown(id, value));
  }

  return [];
}

export function getProjectionHand(projection: RoomProjection | null): Array<Record<string, unknown>> {
  return Array.isArray(projection?.hand)
    ? projection.hand.filter((item) => item && typeof item === "object")
    : [];
}

export function getProjectionCapabilities(projection: RoomProjection | null): Record<string, unknown> {
  const raw = projection?.capabilities;
  return raw && typeof raw === "object" ? { ...raw } : {};
}

export function getProjectionAllowedActions(projection: RoomProjection | null): RoundAction[] {
  const actions = projection?.allowedActions;
  if (!Array.isArray(actions)) {
    return [];
  }

  return actions
    .map((item) => String(item))
    .filter((item): item is RoundAction => (
      item === "ask" ||
      item === "answer" ||
      item === "drawCard" ||
      item === "castCurse" ||
      item === "rollDice" ||
      item === "claimCatch"
    ));
}

export function getPendingQuestion(projection: RoomProjection | null): PendingQuestionProjection | null {
  const pending = projection?.round?.pendingQuestion;
  if (!pending || typeof pending !== "object") {
    return null;
  }
  return pending as PendingQuestionProjection;
}
