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
  activeCurses?: Array<Record<string, unknown>>;
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

export interface PendingRewardChoiceProjection {
  id?: string;
  questionId?: string;
  hiderId?: string;
  keepCount?: number;
  candidateCards?: Array<Record<string, unknown>>;
  createdAt?: string;
  [key: string]: unknown;
}

export type MapProvider = "GOOGLE" | "MAPBOX" | "AMAP" | "CUSTOM";

export interface ProjectionEvidence {
  evidenceId?: string;
  roundNumber?: number;
  actorPlayerId?: string;
  type?: string;
  mimeType?: string | null;
  status?: string;
  metadata?: Record<string, unknown> | null;
  uploadUrl?: string | null;
  viewUrl?: string | null;
  fileName?: string | null;
  storageKey?: string | null;
  createdAt?: string;
  completedAt?: string | null;
  sizeBytes?: number | null;
  [key: string]: unknown;
}

export interface ProjectionDispute {
  id?: string;
  type?: string;
  status?: string;
  votePolicy?: string;
  requiredVoterIds?: string[];
  votes?: Record<string, string>;
  createdBy?: string;
  roundNumber?: number;
  createdAt?: string;
  description?: string;
  payload?: Record<string, unknown> | null;
  resolution?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface ProjectionMessage {
  id?: string;
  messageId?: string;
  kind?: string;
  playerId?: string | null;
  playerName?: string | null;
  text?: string;
  roundNumber?: number;
  createdAt?: string;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface ProjectionRound {
  phase?: string;
  number?: number;
  pendingQuestion?: PendingQuestionProjection | null;
  pendingCatchClaim?: Record<string, unknown> | null;
  summary?: Record<string, unknown> | null;
  pendingRewardChoice?: PendingRewardChoiceProjection | null;
  clues?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface RoomProjection {
  roomId?: string | null;
  id?: string;
  code?: string;
  name?: string;
  phase?: string;
  mapProvider?: MapProvider | string | null;
  transitPackId?: string | null;
  config?: Record<string, unknown> | null;
  round?: ProjectionRound;
  roundNumber?: number;
  pendingQuestionId?: string | null;
  pendingCatchClaimId?: string | null;
  paused?: boolean | Record<string, unknown>;
  summary?: Record<string, unknown> | null;
  hand?: Array<Record<string, unknown>>;
  players?: ProjectionPlayer[] | Record<string, unknown>;
  mapAnnotations?: ProjectionMapAnnotation[];
  disputes?: ProjectionDispute[] | Record<string, unknown>;
  evidence?: ProjectionEvidence[] | Record<string, unknown>;
  messages?: ProjectionMessage[] | Record<string, unknown>;
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

export interface PlaceDetailsResponse {
  place: {
    mapProvider?: string;
    details?: Record<string, unknown> | null;
    legitimacy?: Record<string, unknown> | null;
  };
}

export interface ReverseAdminLevelsResponse {
  admin: {
    mapProvider?: string;
    lat?: number;
    lng?: number;
    adminLevels?: Record<string, unknown> | null;
  };
}

export interface TransitPackSummary {
  packId: string;
  sourceType?: string;
  name?: string;
  city?: string;
  version?: string;
  stopCount?: number;
  routeCount?: number;
}

export interface TransitPackListResponse {
  packs: TransitPackSummary[];
}

export interface AddMapAnnotationResponse {
  annotation: Record<string, unknown>;
}

export interface UpdateRoomConfigResponse {
  room: RoomProjection;
}

export interface EvidenceUploadInitResponse {
  upload: {
    evidenceId: string;
    uploadUrl: string;
    expiresAt: string;
  };
}

export interface EvidenceUploadBinaryResponse {
  upload: {
    storageKey: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    viewUrl: string;
  };
}

export interface EvidenceCompleteResponse {
  evidence: ProjectionEvidence;
}

export interface RewardChoiceResponse {
  reward: {
    keptCardIds?: string[];
    discardedCardIds?: string[];
    [key: string]: unknown;
  };
}

export interface DisputeResponse {
  dispute: ProjectionDispute | Record<string, unknown>;
  status?: string;
}

export interface MessageResponse {
  message: ProjectionMessage | Record<string, unknown>;
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

export interface NextRoundResponse {
  state: {
    roomId: string;
    phase: string;
    nextRoundNumber: number;
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
