import { HidingScreen } from "../screens/phases/HidingScreen";
import { LobbyScreen } from "../screens/phases/LobbyScreen";
import { SeekingScreen } from "../screens/phases/SeekingScreen";
import { SummaryScreen } from "../screens/phases/SummaryScreen";
import { getProjectionPlayers, getScreenPhase } from "../lib/projection";
import type {
  Projection,
  QuestionDef,
  RoomEvent,
  RoundAction,
  TransitPackSummary,
} from "../types";

interface PhaseRouterProps {
  projection: Projection | null;
  events: RoomEvent[];
  questionDefs: QuestionDef[];
  roomCode: string;
  httpBaseUrl: string;
  playerId: string;
  busyAction: string | null;
  transitPacks: TransitPackSummary[];
  onRefreshProjection: () => Promise<void>;
  onToggleReady: () => void;
  onStartRound: () => void;
  onPrepareNextRound: () => void;
  onUpdateRoomConfig: (payload: {
    transitPackId?: string | null;
    borderPolygonGeoJSON?: Record<string, unknown> | null;
    hidingAreaGeoJSON?: Record<string, unknown> | null;
  }) => Promise<void>;
  onPerformRoundAction: (action: RoundAction, payload: Record<string, unknown>) => Promise<void>;
}

export function PhaseRouter({
  projection,
  events,
  questionDefs,
  roomCode,
  httpBaseUrl,
  playerId,
  busyAction,
  transitPacks,
  onRefreshProjection,
  onToggleReady,
  onStartRound,
  onPrepareNextRound,
  onUpdateRoomConfig,
  onPerformRoundAction,
}: PhaseRouterProps) {
  const phase = getScreenPhase(projection);

  if (phase === "HIDING") {
    return <HidingScreen projection={projection} playerId={playerId} />;
  }

  if (phase === "SEEKING") {
    return (
      <SeekingScreen
        projection={projection}
        events={events}
        roomCode={roomCode}
        httpBaseUrl={httpBaseUrl}
        playerId={playerId}
        busyAction={busyAction}
        questionDefs={questionDefs}
        onRefreshProjection={onRefreshProjection}
        onPerformRoundAction={onPerformRoundAction}
      />
    );
  }

  if (phase === "SUMMARY") {
    return (
      <SummaryScreen
        summary={projection?.summary ?? projection?.round?.summary ?? null}
        events={events}
        busyAction={busyAction}
        onPrepareNextRound={onPrepareNextRound}
      />
    );
  }

  return (
    <LobbyScreen
      roomName={projection?.name}
      players={getProjectionPlayers(projection)}
      playerId={playerId}
      mapProvider={projection?.mapProvider}
      transitPackId={projection?.transitPackId}
      borderPolygonGeoJSON={projection?.config?.borderPolygonGeoJSON as Record<string, unknown> | null | undefined}
      hidingAreaGeoJSON={projection?.config?.hidingAreaGeoJSON as Record<string, unknown> | null | undefined}
      transitPacks={transitPacks}
      busyAction={busyAction}
      viewerPreparedNextRound={Boolean(projection?.viewerPreparedNextRound)}
      waitingForNextRound={Boolean(projection?.waitingForNextRound)}
      nextRoundReadyCount={Array.isArray(projection?.nextRoundReadyPlayerIds) ? projection.nextRoundReadyPlayerIds.length : 0}
      onToggleReady={onToggleReady}
      onStartRound={onStartRound}
      onUpdateRoomConfig={onUpdateRoomConfig}
    />
  );
}
