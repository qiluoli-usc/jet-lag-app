import { formatRemaining, type CountdownTarget } from "../lib/phase";
import type { FrontPhase, QuestionDef, RoomEvent, RoomProjection, RoundAction } from "../types";
import { HidingPanel } from "./phase/HidingPanel";
import { LobbyPanel } from "./phase/LobbyPanel";
import { SeekingPanel } from "./phase/SeekingPanel";
import { SummaryPanel } from "./phase/SummaryPanel";

interface PhaseRouterProps {
  phase: FrontPhase;
  countdown: CountdownTarget | null;
  nowMs: number;
  summary: Record<string, unknown> | null;
  projection: RoomProjection | null;
  events: RoomEvent[];
  roomCode: string;
  playerId: string | null;
  busyAction: string | null;
  questionDefs: QuestionDef[];
  onRefreshProjection: () => Promise<void>;
  onPerformRoundAction: (action: RoundAction, payload: Record<string, unknown>) => Promise<void>;
}

export function PhaseRouter({
  phase,
  countdown,
  nowMs,
  summary,
  projection,
  events,
  roomCode,
  playerId,
  busyAction,
  questionDefs,
  onRefreshProjection,
  onPerformRoundAction,
}: PhaseRouterProps) {
  const countdownText = countdown ? `${countdown.label}: ${formatRemaining(countdown.targetAtMs - nowMs)}` : null;

  if (phase === "HIDING") {
    return <HidingPanel countdownText={countdownText} />;
  }
  if (phase === "SEEKING" || phase === "END_GAME" || phase === "CAUGHT") {
    if (!playerId) {
      return (
        <div className="rounded-xl border border-black/10 bg-surface p-5">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-black/50">Seeking</p>
          <h2 className="mt-2 font-heading text-2xl font-bold">Join First</h2>
          <p className="mt-2 text-sm text-black/70">Join the room to use Q&A, cards, dice, catch, and map actions.</p>
          <div className="mt-4 rounded-lg bg-signal px-4 py-3 font-mono text-lg font-semibold text-white">
            {countdownText ?? "Timer unavailable"}
          </div>
        </div>
      );
    }

    return (
      <SeekingPanel
        countdownText={countdownText}
        projection={projection}
        events={events}
        roomCode={roomCode}
        playerId={playerId}
        busyAction={busyAction}
        questionDefs={questionDefs}
        onRefreshProjection={onRefreshProjection}
        onPerformRoundAction={onPerformRoundAction}
      />
    );
  }
  if (phase === "SUMMARY") {
    return <SummaryPanel summary={summary} />;
  }
  return <LobbyPanel />;
}
