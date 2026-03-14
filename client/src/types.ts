import type {
  Role as SharedRole,
  RoundPhase,
  RoomEvent as SharedRoomEvent,
  SnapshotResponse as SharedSnapshotResponse,
  WsServerMessage as SharedWsServerMessage,
} from "@jetlag/shared/protocol";

export type Role = SharedRole;

export type FrontPhase = RoundPhase;

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

export interface ProjectionRound {
  phase?: string;
  number?: number;
  pendingQuestion?: PendingQuestionProjection | null;
  pendingCatchClaim?: Record<string, unknown> | null;
  summary?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface RoomProjection {
  roomId?: string | null;
  id?: string;
  code?: string;
  name?: string;
  phase?: string;
  round?: ProjectionRound;
  roundNumber?: number;
  pendingQuestionId?: string | null;
  pendingCatchClaimId?: string | null;
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

export type SnapshotResponse = SharedSnapshotResponse<RoomProjection>;

export interface JoinRoomResponse {
  player: {
    id: string;
    name: string;
    role: Role;
  };
}

export interface RoomViewResponse {
  room: RoomProjection;
}

export interface QuestionDef {
  key: string;
  label?: string;
  answerLimitSec?: number;
  reward?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface QuestionDefsResponse {
  defs: QuestionDef[];
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

export interface ActionResponse {
  action: RoundAction;
  cursor: string;
  projection: RoomProjection;
  result: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  allowedActions?: string[];
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

export type WsSnapshotMessage = Extract<
  SharedWsServerMessage<RoomProjection>,
  { type: "SNAPSHOT" }
>;

export type WsAppendMessage = Extract<
  SharedWsServerMessage<RoomProjection>,
  { type: "EVENT_APPEND" }
>;

export type WsErrorMessage = Extract<
  SharedWsServerMessage<RoomProjection>,
  { type: "ERROR" }
>;

export type WsServerMessage = SharedWsServerMessage<RoomProjection>;
