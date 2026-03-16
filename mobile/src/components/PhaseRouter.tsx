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
} from "../types";

interface PhaseRouterProps {
  projection: Projection | null;
  events: RoomEvent[];
  questionDefs: QuestionDef[];
  roomCode: string;
  httpBaseUrl: string;
  playerId: string;
  busyAction: string | null;
  onRefreshProjection: () => Promise<void>;
  onToggleReady: () => void;
  onStartRound: () => void;
  onPrepareNextRound: () => void;
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
  onRefreshProjection,
  onToggleReady,
  onStartRound,
  onPrepareNextRound,
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
      players={getProjectionPlayers(projection)}
      playerId={playerId}
      busyAction={busyAction}
      onToggleReady={onToggleReady}
      onStartRound={onStartRound}
    />
  );
}
