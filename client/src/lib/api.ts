import type {
  ActionResponse,
  AddMapAnnotationResponse,
  DebugAdvancePhaseResponse,
  DisputeResponse,
  EvidenceCompleteResponse,
  EvidenceUploadBinaryResponse,
  EvidenceUploadInitResponse,
  JoinRoomResponse,
  LocationUpdateResponse,
  MapPlace,
  MessageResponse,
  NextRoundResponse,
  PlaceDetailsResponse,
  QuestionDefsResponse,
  ReverseAdminLevelsResponse,
  RewardChoiceResponse,
  RoomViewResponse,
  RoundAction,
  SearchPlacesResponse,
  SnapshotResponse,
  TransitPackListResponse,
  UpdateRoomConfigResponse,
} from "../types";
import { getAuthSession } from "./authSession";

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = getAuthSession();
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const message =
      (data.error as { message?: string } | undefined)?.message ??
      `${response.status} ${response.statusText}`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}

function encode(code: string): string {
  return encodeURIComponent(code.trim());
}

export async function createRoom(input: Record<string, unknown>) {
  return request<{ room: { id: string; code?: string }; code: string }>("/rooms", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function registerUser(displayName: string, password: string) {
  return request<{ token: string; user: { id: string; displayName: string; createdAt: string } }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ displayName, password }),
  });
}

export async function loginUser(displayName: string, password: string) {
  return request<{ token: string; user: { id: string; displayName: string; createdAt: string } }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ displayName, password }),
  });
}

export async function joinRoom(code: string, input: { name: string; role: string; playerId?: string }) {
  return request<JoinRoomResponse>(`/rooms/${encode(code)}/join`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function leaveRoom(code: string, input: { playerId: string }) {
  return request<{ left: { roomId: string; playerId: string; left: boolean } }>(`/rooms/${encode(code)}/leave`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function setReady(code: string, input: { playerId: string; ready: boolean }) {
  return request<{ state: { phase: string; ready: boolean; playerId: string } }>(
    `/rooms/${encode(code)}/ready`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function startRound(code: string, input: { playerId: string }) {
  return request<{ state: { phase: string } }>(`/rooms/${encode(code)}/startRound`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function nextRound(code: string, input: { playerId: string }): Promise<NextRoundResponse> {
  return request<NextRoundResponse>(`/rooms/${encode(code)}/next-round`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function fetchSnapshot(
  code: string,
  options: { cursor?: string; limit?: number; playerId?: string | null } = {},
) {
  const params = new URLSearchParams();
  if (options.cursor !== undefined) {
    params.set("cursor", options.cursor);
  }
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options.playerId) {
    params.set("playerId", String(options.playerId));
  }
  const query = params.toString();
  const path = `/rooms/${encode(code)}/snapshot${query ? `?${query}` : ""}`;
  return request<SnapshotResponse>(path, { method: "GET" });
}

export async function fetchRoomView(code: string, playerId: string): Promise<RoomViewResponse> {
  const query = new URLSearchParams({ playerId: String(playerId) });
  return request<RoomViewResponse>(`/rooms/${encode(code)}?${query.toString()}`, {
    method: "GET",
  });
}

export async function performRoundAction(code: string, action: RoundAction, payload: Record<string, unknown>) {
  return request<ActionResponse>(`/rounds/${encode(code)}/${action}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchQuestionDefs() {
  return request<QuestionDefsResponse>("/defs/questions", { method: "GET" });
}

export async function fetchCardDefs() {
  return request<{ defs: Array<Record<string, unknown>> }>("/defs/cards", { method: "GET" });
}

export async function fetchTransitPacks(): Promise<TransitPackListResponse> {
  return request<TransitPackListResponse>("/transit/packs", { method: "GET" });
}

export async function debugAdvancePhase(
  code: string,
  payload: { playerId?: string; steps?: number; winner?: "hider" | "seekers" },
): Promise<DebugAdvancePhaseResponse> {
  return request<DebugAdvancePhaseResponse>(`/rooms/${encode(code)}/dev/advancePhase`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updatePlayerLocation(
  code: string,
  payload: { playerId: string; lat: number; lng: number; accuracy?: number },
): Promise<LocationUpdateResponse> {
  return request<LocationUpdateResponse>(`/rooms/${encode(code)}/location`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function searchRoomPlaces(
  code: string,
  payload: {
    playerId: string;
    query?: string;
    center?: { lat: number; lng: number } | null;
    radiusM?: number;
  },
): Promise<SearchPlacesResponse> {
  return request<SearchPlacesResponse>(`/rooms/${encode(code)}/places/search`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchRoomPlaceDetails(
  code: string,
  payload: { playerId: string; placeId: string },
): Promise<PlaceDetailsResponse> {
  return request<PlaceDetailsResponse>(`/rooms/${encode(code)}/places/details`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function reverseRoomAdminLevels(
  code: string,
  payload: { playerId: string; lat: number; lng: number },
): Promise<ReverseAdminLevelsResponse> {
  return request<ReverseAdminLevelsResponse>(`/rooms/${encode(code)}/admin-levels/reverse`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function addMapAnnotation(
  code: string,
  payload: {
    playerId: string;
    layer?: string;
    geometryType?: string;
    geometry: Record<string, unknown>;
    label?: string;
    sourceQuestionId?: string | null;
  },
): Promise<AddMapAnnotationResponse> {
  return request<AddMapAnnotationResponse>(`/rooms/${encode(code)}/map-annotations`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateRoomConfig(
  code: string,
  payload: {
    playerId: string;
    transitPackId?: string | null;
    borderPolygonGeoJSON?: Record<string, unknown> | null;
    hidingAreaGeoJSON?: Record<string, unknown> | null;
  },
): Promise<UpdateRoomConfigResponse> {
  return request<UpdateRoomConfigResponse>(`/rooms/${encode(code)}/config`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function initEvidenceUpload(
  code: string,
  payload: {
    playerId: string;
    type?: string;
    mimeType?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<EvidenceUploadInitResponse> {
  return request<EvidenceUploadInitResponse>(`/rooms/${encode(code)}/evidence/upload-init`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function uploadEvidenceBinary(
  uploadUrl: string,
  payload: {
    file: File;
  },
): Promise<EvidenceUploadBinaryResponse> {
  const session = getAuthSession();
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": payload.file.type || "application/octet-stream",
      "X-Upload-Filename": encodeURIComponent(payload.file.name),
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: payload.file,
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const message =
      (data.error as { message?: string } | undefined)?.message ??
      `${response.status} ${response.statusText}`;
    throw new ApiError(response.status, message);
  }
  return data as unknown as EvidenceUploadBinaryResponse;
}

export async function completeEvidenceUpload(
  code: string,
  payload: {
    playerId: string;
    evidenceId: string;
    storageKey: string;
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number | null;
    viewUrl?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<EvidenceCompleteResponse> {
  return request<EvidenceCompleteResponse>(`/rooms/${encode(code)}/evidence/complete`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function chooseRewardCards(
  code: string,
  payload: {
    playerId: string;
    cardIds: string[];
  },
): Promise<RewardChoiceResponse> {
  return request<RewardChoiceResponse>(`/rooms/${encode(code)}/rewards/choose`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function castPlayerCard(
  code: string,
  payload: {
    playerId: string;
    cardId: string;
    targetPlayerId?: string | null;
    discardCardIds?: string[];
  },
): Promise<{ effect: Record<string, unknown> | Array<Record<string, unknown>> }> {
  return request<{ effect: Record<string, unknown> | Array<Record<string, unknown>> }>(`/rooms/${encode(code)}/cards/cast`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createDispute(
  code: string,
  payload: {
    playerId: string;
    type: string;
    description: string;
    votePolicy?: string;
    payload?: Record<string, unknown>;
    autoPause?: boolean;
  },
): Promise<DisputeResponse> {
  return request<DisputeResponse>(`/rooms/${encode(code)}/disputes`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function voteDispute(
  code: string,
  disputeId: string,
  payload: {
    playerId: string;
    vote: "accept" | "reject";
    resumeAfterResolve?: boolean;
  },
): Promise<DisputeResponse> {
  return request<DisputeResponse>(`/rooms/${encode(code)}/disputes/${encode(disputeId)}/vote`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function resolveCatch(
  code: string,
  claimId: string,
  payload: {
    playerId: string;
    result: "success" | "failed";
    reason?: string | null;
  },
): Promise<{ result: Record<string, unknown> }> {
  return request<{ result: Record<string, unknown> }>(`/rooms/${encode(code)}/catch/${encode(claimId)}/respond`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function sendChatMessage(
  code: string,
  payload: {
    playerId: string;
    text: string;
    replyToMessageId?: string | null;
  },
): Promise<MessageResponse> {
  return request<MessageResponse>(`/rooms/${encode(code)}/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function sendClue(
  code: string,
  payload: {
    playerId: string;
    text: string;
  },
): Promise<{ clue: Record<string, unknown> }> {
  return request<{ clue: Record<string, unknown> }>(`/rooms/${encode(code)}/clues`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function toPlaceCenter(place: MapPlace): { lat: number; lng: number } | null {
  const lat = Number(place.lat);
  const lng = Number(place.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

export { ApiError };
