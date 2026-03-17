import type {
  AddMapAnnotationResponse,
  ActionResponse,
  CardDefsResponse,
  CreateRoomResponse,
  DebugAdvancePhaseResponse,
  DisputeResponse,
  EvidenceCompleteResponse,
  EvidenceUploadBinaryResponse,
  EvidenceUploadInitResponse,
  JoinRoomResponse,
  LeaveRoomResponse,
  LocationUpdateResponse,
  MessageResponse,
  NextRoundResponse,
  PlaceDetailsResponse,
  QuestionDefsResponse,
  ReadyResponse,
  ReverseAdminLevelsResponse,
  RewardChoiceResponse,
  Role,
  RoomViewResponse,
  RoundAction,
  SearchPlacesResponse,
  SnapshotResponse,
  StartRoundResponse,
  TransitPackListResponse,
  UpdateRoomConfigResponse,
} from "../types";
import { Platform } from "react-native";
import { getAuthSession } from "./authSession";

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 10000;

function normalizeBaseUrl(baseUrl: string): string {
  return String(baseUrl).replace(/\/+$/, "");
}

function maybeAndroidEmulatorFallbackBaseUrl(baseUrl: string): string | null {
  if (Platform.OS !== "android") {
    return null;
  }

  const normalized = normalizeBaseUrl(baseUrl);
  if (/^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(normalized)) {
    return normalized.replace("127.0.0.1", "10.0.2.2");
  }
  if (/^https?:\/\/localhost(?::\d+)?$/i.test(normalized)) {
    return normalized.replace("localhost", "10.0.2.2");
  }
  return null;
}

async function request<T>(baseUrl: string, path: string, init: RequestInit = {}): Promise<T> {
  const requestWithTimeout = async (effectiveBaseUrl: string): Promise<Response> => {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      : null;

    try {
      const authSession = await getAuthSession();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> ?? {}),
      };
      
      if (authSession?.token) {
        headers["Authorization"] = `Bearer ${authSession.token}`;
      }

      return await fetch(`${normalizeBaseUrl(effectiveBaseUrl)}${path}`, {
        ...init,
        signal: controller?.signal,
        headers,
      });
    } catch (caught) {
      if (controller?.signal.aborted) {
        throw new ApiError(408, `Request timeout (${REQUEST_TIMEOUT_MS}ms): ${path}`);
      }
      if (caught instanceof ApiError) {
        throw caught;
      }
      if (caught instanceof Error) {
        throw new ApiError(0, caught.message);
      }
      throw new ApiError(0, "Network request failed");
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  };

  let response: Response;
  try {
    response = await requestWithTimeout(baseUrl);
  } catch (caught) {
    const fallbackBaseUrl = maybeAndroidEmulatorFallbackBaseUrl(baseUrl);
    if (caught instanceof ApiError && caught.status === 0 && fallbackBaseUrl && fallbackBaseUrl !== normalizeBaseUrl(baseUrl)) {
      response = await requestWithTimeout(fallbackBaseUrl);
    } else if (caught instanceof ApiError && caught.status === 0) {
      const requestUrl = `${normalizeBaseUrl(baseUrl)}${path}`;
      throw new ApiError(0, `Network request failed: ${requestUrl}`);
    } else {
      throw caught;
    }
  }

  const text = await response.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }

  if (!response.ok) {
    const errorPayload = data.error as { message?: string } | undefined;
    throw new ApiError(response.status, errorPayload?.message ?? `${response.status} ${response.statusText}`);
  }

  return data as T;
}

function encode(value: string): string {
  return encodeURIComponent(value.trim());
}

export async function createRoom(
  httpBaseUrl: string,
  payload: {
    name: string;
    transitPackId?: string | null;
  },
): Promise<CreateRoomResponse> {
  return request<CreateRoomResponse>(httpBaseUrl, "/rooms", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function joinRoom(
  httpBaseUrl: string,
  code: string,
  payload: { name: string; role: Role; playerId?: string },
): Promise<JoinRoomResponse> {
  return request<JoinRoomResponse>(httpBaseUrl, `/rooms/${encode(code)}/join`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function setReady(
  httpBaseUrl: string,
  code: string,
  payload: { playerId: string; ready: boolean },
): Promise<ReadyResponse> {
  return request<ReadyResponse>(httpBaseUrl, `/rooms/${encode(code)}/ready`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function leaveRoom(
  httpBaseUrl: string,
  code: string,
  payload: { playerId: string },
): Promise<LeaveRoomResponse> {
  return request<LeaveRoomResponse>(httpBaseUrl, `/rooms/${encode(code)}/leave`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function registerUser(baseUrl: string, displayName: string, passwordString: string) {
  return await request<{ token: string; user: { id: string; displayName: string; createdAt: string } }>(
    baseUrl,
    "/auth/register",
    {
      method: "POST",
      body: JSON.stringify({ displayName, password: passwordString }),
    }
  );
}

export async function loginUser(baseUrl: string, displayName: string, passwordString: string) {
  return await request<{ token: string; user: { id: string; displayName: string; createdAt: string } }>(
    baseUrl,
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ displayName, password: passwordString }),
    }
  );
}

export async function startRound(
  httpBaseUrl: string,
  code: string,
  payload: { playerId: string },
): Promise<StartRoundResponse> {
  return request<StartRoundResponse>(httpBaseUrl, `/rooms/${encode(code)}/startRound`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function nextRound(
  httpBaseUrl: string,
  code: string,
  payload: { playerId: string },
): Promise<NextRoundResponse> {
  return request<NextRoundResponse>(httpBaseUrl, `/rooms/${encode(code)}/next-round`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function debugAdvancePhase(
  httpBaseUrl: string,
  code: string,
  payload: { playerId?: string; steps?: number; winner?: "hider" | "seekers" },
): Promise<DebugAdvancePhaseResponse> {
  return request<DebugAdvancePhaseResponse>(httpBaseUrl, `/rooms/${encode(code)}/dev/advancePhase`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchSnapshot(
  httpBaseUrl: string,
  code: string,
  playerId?: string | null,
): Promise<SnapshotResponse> {
  const query = new URLSearchParams({ limit: "160" });
  if (playerId) {
    query.set("playerId", String(playerId));
  }
  return request<SnapshotResponse>(httpBaseUrl, `/rooms/${encode(code)}/snapshot?${query.toString()}`, {
    method: "GET",
  });
}

export async function fetchRoomView(
  httpBaseUrl: string,
  code: string,
  playerId: string,
): Promise<RoomViewResponse> {
  const query = new URLSearchParams({ playerId: String(playerId) });
  return request<RoomViewResponse>(httpBaseUrl, `/rooms/${encode(code)}?${query.toString()}`, {
    method: "GET",
  });
}

export async function fetchQuestionDefs(httpBaseUrl: string): Promise<QuestionDefsResponse> {
  return request<QuestionDefsResponse>(httpBaseUrl, "/defs/questions", {
    method: "GET",
  });
}

export async function fetchCardDefs(httpBaseUrl: string): Promise<CardDefsResponse> {
  return request<CardDefsResponse>(httpBaseUrl, "/defs/cards", {
    method: "GET",
  });
}

export async function fetchTransitPacks(httpBaseUrl: string): Promise<TransitPackListResponse> {
  return request<TransitPackListResponse>(httpBaseUrl, "/transit/packs", {
    method: "GET",
  });
}

export async function updatePlayerLocation(
  httpBaseUrl: string,
  code: string,
  payload: { playerId: string; lat: number; lng: number; accuracy?: number },
): Promise<LocationUpdateResponse> {
  return request<LocationUpdateResponse>(httpBaseUrl, `/rooms/${encode(code)}/location`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function searchRoomPlaces(
  httpBaseUrl: string,
  code: string,
  payload: {
    playerId: string;
    query?: string;
    center?: { lat: number; lng: number } | null;
    radiusM?: number;
  },
): Promise<SearchPlacesResponse> {
  return request<SearchPlacesResponse>(httpBaseUrl, `/rooms/${encode(code)}/places/search`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchRoomPlaceDetails(
  httpBaseUrl: string,
  code: string,
  payload: { playerId: string; placeId: string },
): Promise<PlaceDetailsResponse> {
  return request<PlaceDetailsResponse>(httpBaseUrl, `/rooms/${encode(code)}/places/details`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function reverseRoomAdminLevels(
  httpBaseUrl: string,
  code: string,
  payload: { playerId: string; lat: number; lng: number },
): Promise<ReverseAdminLevelsResponse> {
  return request<ReverseAdminLevelsResponse>(httpBaseUrl, `/rooms/${encode(code)}/admin-levels/reverse`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function addMapAnnotation(
  httpBaseUrl: string,
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
  return request<AddMapAnnotationResponse>(httpBaseUrl, `/rooms/${encode(code)}/map-annotations`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateRoomConfig(
  httpBaseUrl: string,
  code: string,
  payload: {
    playerId: string;
    transitPackId?: string | null;
    borderPolygonGeoJSON?: Record<string, unknown> | null;
    hidingAreaGeoJSON?: Record<string, unknown> | null;
  },
): Promise<UpdateRoomConfigResponse> {
  return request<UpdateRoomConfigResponse>(httpBaseUrl, `/rooms/${encode(code)}/config`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function chooseRewardCards(
  httpBaseUrl: string,
  code: string,
  payload: {
    playerId: string;
    cardIds: string[];
  },
): Promise<RewardChoiceResponse> {
  return request<RewardChoiceResponse>(httpBaseUrl, `/rooms/${encode(code)}/rewards/choose`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function castPlayerCard(
  httpBaseUrl: string,
  code: string,
  payload: {
    playerId: string;
    cardId: string;
    targetPlayerId?: string | null;
    discardCardIds?: string[];
  },
): Promise<{ effect: Record<string, unknown> | Array<Record<string, unknown>> }> {
  return request<{ effect: Record<string, unknown> | Array<Record<string, unknown>> }>(
    httpBaseUrl,
    `/rooms/${encode(code)}/cards/cast`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function initEvidenceUpload(
  httpBaseUrl: string,
  code: string,
  payload: {
    playerId: string;
    type?: string;
    mimeType?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<EvidenceUploadInitResponse> {
  return request<EvidenceUploadInitResponse>(httpBaseUrl, `/rooms/${encode(code)}/evidence/upload-init`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function uploadEvidenceBinary(
  httpBaseUrl: string,
  uploadUrl: string,
  payload: {
    uri: string;
    mimeType?: string | null;
    fileName?: string | null;
    onProgress?: (progress: number) => void;
  },
): Promise<EvidenceUploadBinaryResponse> {
  const localResponse = await fetch(payload.uri);
  const blob = await localResponse.blob();

  return new Promise<EvidenceUploadBinaryResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${normalizeBaseUrl(httpBaseUrl)}${uploadUrl}`);
    xhr.setRequestHeader("Content-Type", payload.mimeType || "application/octet-stream");
    if (payload.fileName) {
      xhr.setRequestHeader("X-Upload-Filename", encodeURIComponent(payload.fileName));
    }
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(xhr.status, xhr.responseText || `Upload failed: ${xhr.status}`));
        return;
      }
      try {
        const parsed = JSON.parse(xhr.responseText) as EvidenceUploadBinaryResponse;
        payload.onProgress?.(1);
        resolve(parsed);
      } catch {
        reject(new ApiError(xhr.status, "Upload completed but response was invalid"));
      }
    };
    xhr.onerror = () => {
      reject(new ApiError(0, "Binary upload failed"));
    };
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        payload.onProgress?.(event.loaded / event.total);
      }
    };
    xhr.send(blob);
  });
}

export async function completeEvidenceUpload(
  httpBaseUrl: string,
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
  return request<EvidenceCompleteResponse>(httpBaseUrl, `/rooms/${encode(code)}/evidence/complete`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createDispute(
  httpBaseUrl: string,
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
  return request<DisputeResponse>(httpBaseUrl, `/rooms/${encode(code)}/disputes`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function voteDispute(
  httpBaseUrl: string,
  code: string,
  disputeId: string,
  payload: {
    playerId: string;
    vote: "accept" | "reject";
    resumeAfterResolve?: boolean;
  },
): Promise<DisputeResponse> {
  return request<DisputeResponse>(httpBaseUrl, `/rooms/${encode(code)}/disputes/${encode(disputeId)}/vote`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function resolveCatch(
  httpBaseUrl: string,
  code: string,
  claimId: string,
  payload: {
    playerId: string;
    result: "success" | "failed";
    reason?: string | null;
  },
): Promise<{ result: Record<string, unknown> }> {
  return request<{ result: Record<string, unknown> }>(httpBaseUrl, `/rooms/${encode(code)}/catch/${encode(claimId)}/respond`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function sendChatMessage(
  httpBaseUrl: string,
  code: string,
  payload: {
    playerId: string;
    text: string;
    replyToMessageId?: string | null;
  },
): Promise<MessageResponse> {
  return request<MessageResponse>(httpBaseUrl, `/rooms/${encode(code)}/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function sendClue(
  httpBaseUrl: string,
  code: string,
  payload: {
    playerId: string;
    text: string;
  },
): Promise<{ clue: Record<string, unknown> }> {
  return request<{ clue: Record<string, unknown> }>(httpBaseUrl, `/rooms/${encode(code)}/clues`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function performRoundAction(
  httpBaseUrl: string,
  code: string,
  action: RoundAction,
  payload: Record<string, unknown>,
): Promise<ActionResponse> {
  return request<ActionResponse>(httpBaseUrl, `/rounds/${encode(code)}/${action}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export { ApiError };
