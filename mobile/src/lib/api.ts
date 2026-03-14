import type {
  AddMapAnnotationResponse,
  ActionResponse,
  CardDefsResponse,
  CreateRoomResponse,
  DebugAdvancePhaseResponse,
  JoinRoomResponse,
  LeaveRoomResponse,
  LocationUpdateResponse,
  QuestionDefsResponse,
  ReadyResponse,
  RewardChoiceResponse,
  Role,
  RoomViewResponse,
  RoundAction,
  SearchPlacesResponse,
  SnapshotResponse,
  StartRoundResponse,
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

export async function createRoom(httpBaseUrl: string, name: string): Promise<CreateRoomResponse> {
  return request<CreateRoomResponse>(httpBaseUrl, "/rooms", {
    method: "POST",
    body: JSON.stringify({
      name,
    }),
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
