import type {
  Role as SharedRole,
  RoomEvent as SharedRoomEvent,
  ScreenPhase as SharedScreenPhase,
  SnapshotResponse as SharedSnapshotResponse,
  WsServerMessage as SharedWsServerMessage,
} from "@jetlag/shared/protocol";

export type Role = SharedRole;

export type ScreenPhase = SharedScreenPhase;

export type RoomEvent = SharedRoomEvent;

export type RoundAction =
  | "ask"
  | "answer"
  | "drawCard"
  | "castCurse"
  | "rollDice"
  | "claimCatch";

export interface ProjectionPlayer {
  id: string;
  name?: string;
  role?: Role;
  ready?: boolean;
  inTransit?: boolean;
  location?: {
    lat?: number;
    lng?: number;
    accuracy?: number;
    ts?: string;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface ProjectionMapAnnotation {
  id?: string;
  annotationId?: string;
  playerId?: string;
  layer?: string;
  geometryType?: string;
  geometry?: Record<string, unknown> | null;
  label?: string;
  sourceQuestionId?: string | null;
  createdAt?: string;
  [key: string]: unknown;
}

export interface PendingQuestionProjection {
  id?: string;
  playerId?: string;
  category?: string;
  prompt?: string;
  optionKey?: string | number | null;
  status?: string;
  dueAt?: string | null;
  [key: string]: unknown;
}

export interface PendingRewardChoiceProjection {
  id?: string;
  questionId?: string;
  hiderId?: string;
  keepCount?: number;
  candidateCards?: Array<Record<string, unknown>>;
  createdAt?: string;
  [key: string]: unknown;
}

export interface ProjectionRound {
  phase?: string;
  number?: number;
  pendingQuestion?: PendingQuestionProjection | null;
  pendingRewardChoice?: PendingRewardChoiceProjection | null;
  pendingCatchClaim?: Record<string, unknown> | null;
  summary?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface Projection {
  roomId?: string | null;
  id?: string;
  code?: string;
  name?: string;
  phase?: string;
  round?: ProjectionRound;
  paused?: boolean | Record<string, unknown>;
  summary?: Record<string, unknown> | null;
  hand?: Array<Record<string, unknown>>;
  players?: ProjectionPlayer[] | Record<string, unknown>;
  mapAnnotations?: ProjectionMapAnnotation[];
  capabilities?: Record<string, unknown>;
  allowedActions?: string[];
  counters?: {
    total?: number;
    byType?: Record<string, number>;
  };
  [key: string]: unknown;
}

export type SnapshotResponse = SharedSnapshotResponse<Projection>;

export interface CreateRoomResponse {
  code: string;
  room: {
    id: string;
    code?: string;
  };
}

export interface JoinRoomResponse {
  player: {
    id: string;
    name: string;
    role: Role;
  };
}

export interface LeaveRoomResponse {
  left: {
    roomId: string;
    playerId: string;
    left: boolean;
    phase: string;
    remainingPlayers: number;
  };
}

export interface RoomViewResponse {
  room: Projection;
}

export interface LocationUpdateResponse {
  location: {
    playerId: string;
    updatedAt: string;
    signature: string;
  };
}

export interface MapPlace {
  placeId?: string;
  name?: string;
  lat?: number;
  lng?: number;
  distanceMeters?: number;
  categories?: string[];
  [key: string]: unknown;
}

export interface SearchPlacesResponse {
  places: {
    mapProvider?: string;
    query?: string;
    center?: Record<string, unknown> | null;
    radiusM?: number;
    count?: number;
    places?: MapPlace[];
  };
}

export interface AddMapAnnotationResponse {
  annotation: Record<string, unknown>;
}

export interface RewardChoiceResponse {
  reward: {
    keptCardIds?: string[];
    discardedCardIds?: string[];
    [key: string]: unknown;
  };
}

export interface ActionResponse {
  action: RoundAction;
  cursor: string;
  projection: Projection;
  result: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  allowedActions?: string[];
}

export interface ReadyResponse {
  state: {
    phase: string;
    ready: boolean;
    playerId: string;
  };
}

export interface StartRoundResponse {
  state: {
    phase: string;
  };
}

export interface NextRoundResponse {
  state: {
    roomId: string;
    phase: string;
    nextRoundNumber: number;
  };
}

export interface DebugAdvancePhaseResponse {
  state: {
    roomId: string;
    phase: string;
    roundNumber: number;
    stepsApplied: number;
    hideEndsAt?: string | null;
    seekEndsAt?: string | null;
  };
}

export interface QuestionDef {
  key: string;
  label?: string;
  answerLimitSec?: number;
  reward?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface QuestionDefsResponse {
  version?: string;
  defs: QuestionDef[];
}

export interface CardDefsResponse {
  version?: string;
  defs: Array<Record<string, unknown>>;
}

export type WsSnapshotMessage = Extract<
  SharedWsServerMessage<Projection>,
  { type: "SNAPSHOT" }
>;

export type WsAppendMessage = Extract<
  SharedWsServerMessage<Projection>,
  { type: "EVENT_APPEND" }
>;

export type WsErrorMessage = Extract<
  SharedWsServerMessage<Projection>,
  { type: "ERROR" }
>;

export type WsMessage = SharedWsServerMessage<Projection>;
