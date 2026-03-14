export type Role = "hider" | "seeker" | "observer";

export type RoundPhase =
  | "LOBBY"
  | "HIDING"
  | "SEEKING"
  | "END_GAME"
  | "CAUGHT"
  | "SUMMARY";

export type ScreenPhase = "LOBBY" | "HIDING" | "SEEKING" | "SUMMARY";

export interface RoomEvent {
  id: string;
  roomId: string;
  ts: string;
  type: string;
  actorId: string | null;
  visibility: string;
  data: Record<string, unknown>;
}

export interface SnapshotResponse<TProjection = Record<string, unknown>> {
  roomProjection: TProjection;
  lastEvents: RoomEvent[];
  cursor: string;
  roomId: string;
  code: string;
}

export interface WsSnapshotMessage<TProjection = Record<string, unknown>> {
  type: "SNAPSHOT";
  roomCode: string;
  projection: TProjection;
  cursor: string;
}

export interface WsAppendMessage {
  type: "EVENT_APPEND";
  roomCode: string;
  event: RoomEvent;
  cursor: string;
}

export interface WsErrorMessage {
  type: "ERROR";
  status: number;
  message: string;
}

export type WsServerMessage<TProjection = Record<string, unknown>> =
  | WsSnapshotMessage<TProjection>
  | WsAppendMessage
  | WsErrorMessage;