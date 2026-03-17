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

export type MapProvider = "GOOGLE" | "MAPBOX" | "AMAP" | "CUSTOM";

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

export interface Projection {
  roomId?: string | null;
  id?: string;
  code?: string;
  name?: string;
  phase?: string;
  mapProvider?: MapProvider | string | null;
  transitPackId?: string | null;
  config?: Record<string, unknown> | null;
  round?: ProjectionRound;
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

export type SnapshotResponse = SharedSnapshotResponse<Projection>;

export interface CreateRoomResponse {
  code: string;
  room: {
    id: string;
    code?: string;
    mapProvider?: MapProvider | string | null;
    transitPackId?: string | null;
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

export interface UpdateRoomConfigResponse {
  room: Projection;
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
