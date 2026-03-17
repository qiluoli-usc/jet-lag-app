import type {
  ProjectionDispute,
  ProjectionEvidence,
  ProjectionMessage,
  PendingRewardChoiceProjection,
  PendingQuestionProjection,
  Projection,
  ProjectionPlayer,
  RoomEvent,
  RoundAction,
  ScreenPhase,
} from "../types";

export const ACTION_CAPABILITY_KEY: Record<RoundAction, string> = {
  ask: "canAskQuestion",
  answer: "canAnswerQuestion",
  drawCard: "canDrawCard",
  castCurse: "canCastCard",
  rollDice: "canRollDice",
  claimCatch: "canClaimCatch",
};

function normalizePhaseValue(value: unknown): ScreenPhase {
  const phase = String(value ?? "").toUpperCase();

  if (phase === "HIDE" || phase === "HIDING") {
    return "HIDING";
  }
  if (
    phase === "SEEK" ||
    phase === "SEEKING" ||
    phase === "ENDGAME" ||
    phase === "END_GAME" ||
    phase === "CAUGHT"
  ) {
    return "SEEKING";
  }
  if (phase === "SUMMARY") {
    return "SUMMARY";
  }
  return "LOBBY";
}

export function getScreenPhase(projection: Projection | null): ScreenPhase {
  const raw = projection?.phase ?? projection?.round?.phase;
  return normalizePhaseValue(raw);
}

export function normalizeProjection(input: Projection | null | undefined): Projection {
  const projection = input ?? {};
  const phase = normalizePhaseValue(projection.phase ?? projection.round?.phase);

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

function phaseFromEvent(eventType: string, current: ScreenPhase): ScreenPhase {
  switch (eventType) {
    case "phase.hide.started":
      return "HIDING";
    case "phase.seek.started":
    case "phase.end_game.started":
    case "catch.failed.return_to_seek":
      return "SEEKING";
    case "summary.generated":
      return "SUMMARY";
    case "round.prepared":
    case "room.created":
      return "LOBBY";
    default:
      return current;
  }
}

export function applyEventToProjection(current: Projection | null, event: RoomEvent): Projection {
  const base = normalizeProjection(current);
  const nextPhase = phaseFromEvent(event.type, getScreenPhase(base));

  const nextByType = {
    ...(base.counters?.byType ?? {}),
  };
  nextByType[event.type] = Number(nextByType[event.type] ?? 0) + 1;

  const nextProjection: Projection = {
    ...base,
    phase: nextPhase,
    round: {
      ...(base.round ?? {}),
      phase: nextPhase,
    },
    counters: {
      total: Number(base.counters?.total ?? 0) + 1,
      byType: nextByType,
    },
    summary: event.type === "summary.generated" ? event.data : base.summary,
  };

  if (event.type === "room.created" || event.type === "room.config.updated") {
    nextProjection.mapProvider = String(event.data?.mapProvider ?? base.mapProvider ?? "").trim() || null;
    nextProjection.transitPackId = event.data?.transitPackId == null
      ? (base.transitPackId ?? null)
      : String(event.data.transitPackId).trim() || null;
    nextProjection.config = event.data?.config && typeof event.data.config === "object"
      ? { ...(event.data.config as Record<string, unknown>) }
      : (base.config ?? null);
  }

  if (event.type === "message.sent") {
    const existing = Array.isArray(base.messages) ? base.messages : [];
    nextProjection.messages = [
      ...existing,
      {
        id: typeof event.data?.messageId === "string" ? event.data.messageId : undefined,
        messageId: typeof event.data?.messageId === "string" ? event.data.messageId : undefined,
        kind: typeof event.data?.kind === "string" ? event.data.kind : undefined,
        playerId: typeof event.data?.playerId === "string" ? event.data.playerId : null,
        text: typeof event.data?.text === "string" ? event.data.text : undefined,
        roundNumber: typeof event.data?.roundNumber === "number" ? event.data.roundNumber : undefined,
        createdAt: typeof event.data?.createdAt === "string" ? event.data.createdAt : undefined,
        metadata: event.data?.metadata && typeof event.data.metadata === "object"
          ? (event.data.metadata as Record<string, unknown>)
          : null,
      },
    ].slice(-80);
  }

  return nextProjection;
}

function playerFromUnknown(id: string, value: unknown): ProjectionPlayer {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    id,
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

export function getProjectionPlayers(projection: Projection | null): ProjectionPlayer[] {
  const raw = projection?.players;
  if (Array.isArray(raw)) {
    return raw
      .filter((item) => item && typeof item === "object")
      .map((item, index) => {
        const row = item as ProjectionPlayer;
        const id = typeof row.id === "string" && row.id.length > 0 ? row.id : `player_${index}`;
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

export function getProjectionHand(projection: Projection | null): Array<Record<string, unknown>> {
  return Array.isArray(projection?.hand)
    ? projection.hand.filter((item) => item && typeof item === "object")
    : [];
}

export function getProjectionEvidence(projection: Projection | null): ProjectionEvidence[] {
  return Array.isArray(projection?.evidence)
    ? projection.evidence.filter((item): item is ProjectionEvidence => Boolean(item && typeof item === "object"))
    : [];
}

export function getProjectionDisputes(projection: Projection | null): ProjectionDispute[] {
  return Array.isArray(projection?.disputes)
    ? projection.disputes.filter((item): item is ProjectionDispute => Boolean(item && typeof item === "object"))
    : [];
}

export function getProjectionMessages(projection: Projection | null): ProjectionMessage[] {
  return Array.isArray(projection?.messages)
    ? projection.messages.filter((item): item is ProjectionMessage => Boolean(item && typeof item === "object"))
    : [];
}

export function getProjectionCapabilities(projection: Projection | null): Record<string, unknown> {
  const raw = projection?.capabilities;
  return raw && typeof raw === "object" ? { ...raw } : {};
}

export function getProjectionAllowedActions(projection: Projection | null): RoundAction[] {
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

export function getPendingQuestion(projection: Projection | null): PendingQuestionProjection | null {
  const pending = projection?.round?.pendingQuestion;
  if (!pending || typeof pending !== "object") {
    return null;
  }
  return pending as PendingQuestionProjection;
}

export function getPendingRewardChoice(projection: Projection | null): PendingRewardChoiceProjection | null {
  const pending = projection?.round?.pendingRewardChoice;
  if (!pending || typeof pending !== "object") {
    return null;
  }
  return pending as PendingRewardChoiceProjection;
}

export function hasAllowedAction(projection: Projection | null, action: RoundAction): boolean {
  return getProjectionAllowedActions(projection).includes(action);
}
