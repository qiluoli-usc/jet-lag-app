import type {
  ActionResponse,
  AddMapAnnotationResponse,
  DebugAdvancePhaseResponse,
  JoinRoomResponse,
  LocationUpdateResponse,
  MapPlace,
  QuestionDefsResponse,
  RoomViewResponse,
  RoundAction,
  SearchPlacesResponse,
  SnapshotResponse,
} from "../types";

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
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

export function toPlaceCenter(place: MapPlace): { lat: number; lng: number } | null {
  const lat = Number(place.lat);
  const lng = Number(place.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

export { ApiError };
