import type { ReactNode } from "react";

interface RoomShellProps {
  roomCode: string;
  phaseLabel: string;
  wsState: "connecting" | "open" | "closed" | "error";
  playerId: string | null;
  onRefresh: () => void;
  controls: ReactNode;
  main: ReactNode;
  side: ReactNode;
}

function wsBadgeClass(wsState: RoomShellProps["wsState"]): string {
  if (wsState === "open") {
    return "bg-emerald-100 text-emerald-900";
  }
  if (wsState === "connecting") {
    return "bg-amber-100 text-amber-900";
  }
  return "bg-rose-100 text-rose-900";
}

export function RoomShell(props: RoomShellProps) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <header className="grain rounded-2xl border border-black/10 bg-white/80 p-4 shadow-soft backdrop-blur-sm md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-black/50">Room Code</p>
            <h1 className="font-heading text-2xl font-bold tracking-tight md:text-3xl">{props.roomCode}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-accent/10 px-3 py-1 text-sm font-semibold text-accent">
              {props.phaseLabel}
            </span>
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ${wsBadgeClass(props.wsState)}`}>
              WS: {props.wsState}
            </span>
            <button
              type="button"
              onClick={props.onRefresh}
              className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-sm font-medium transition hover:bg-black hover:text-white"
            >
              Refresh
            </button>
          </div>
        </div>
        <p className="mt-3 text-sm text-black/60">
          Player: <span className="font-mono">{props.playerId ?? "not joined"}</span>
        </p>
        <div className="mt-4">{props.controls}</div>
      </header>

      <section className="mt-6 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-black/10 bg-white/85 p-4 shadow-soft md:p-5">{props.main}</div>
        <aside className="rounded-2xl border border-black/10 bg-white/85 p-4 shadow-soft md:p-5">{props.side}</aside>
      </section>
    </div>
  );
}
