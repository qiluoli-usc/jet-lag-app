interface SummaryPanelProps {
  summary: Record<string, unknown> | null;
  busyAction: string | null;
  onPrepareNextRound: () => Promise<void>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown, fallback = "-"): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : [];
}

function formatDuration(value: unknown): string {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatReason(reason: string): string {
  switch (reason) {
    case "catch_success":
    case "catch_success_distance_auto":
      return "Seekers caught the hider";
    case "seek_timer_elapsed":
      return "Seek timer elapsed";
    default:
      return reason.replace(/_/g, " ");
  }
}

export function SummaryPanel({ summary, busyAction, onPrepareNextRound }: SummaryPanelProps) {
  const data = asRecord(summary);
  const questions = asArray(data.questions);
  const cardMoments = asArray(data.cardMoments);
  const evidence = asArray(data.evidence);
  const disputes = asArray(data.disputes);
  const clues = asArray(data.clues);
  const messages = asArray(data.messages);

  return (
    <div className="rounded-xl border border-black/10 bg-surface p-5">
      <p className="font-mono text-xs uppercase tracking-[0.24em] text-black/50">Summary</p>
      <h2 className="mt-2 font-heading text-2xl font-bold">
        {asText(data.winner) === "seekers" ? "Seekers Win" : "Hider Wins"}
      </h2>
      <p className="mt-2 text-sm text-black/70">{formatReason(asText(data.reason, "unknown"))}</p>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-black/10 bg-white p-3 text-sm">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-black/45">Seek Time</p>
          <p className="mt-1 font-semibold">{formatDuration(data.seekDurationSec)}</p>
        </div>
        <div className="rounded-lg border border-black/10 bg-white p-3 text-sm">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-black/45">Hide Time</p>
          <p className="mt-1 font-semibold">{formatDuration(data.effectiveHideDurationSec)}</p>
        </div>
        <div className="rounded-lg border border-black/10 bg-white p-3 text-sm">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-black/45">Questions</p>
          <p className="mt-1 font-semibold">{questions.length}</p>
        </div>
        <div className="rounded-lg border border-black/10 bg-white p-3 text-sm">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-black/45">Evidence</p>
          <p className="mt-1 font-semibold">{evidence.length}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-black/10 bg-white p-4">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/50">Questions</p>
          <div className="mt-3 space-y-2 text-sm">
            {questions.length === 0 ? (
              <p className="text-black/55">No structured questions recorded.</p>
            ) : (
              questions.map((item) => {
                const answer = asRecord(item.answer);
                return (
                  <div key={asText(item.questionId)} className="rounded-lg border border-black/10 bg-surface p-3">
                    <p className="font-semibold">{asText(item.category, "question")}</p>
                    <p className="mt-1 text-black/75">{asText(item.prompt)}</p>
                    <p className="mt-1 text-xs text-black/55">Answer: {asText(answer.value, "pending")}</p>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="rounded-xl border border-black/10 bg-white p-4">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/50">Cards And Curses</p>
          <div className="mt-3 space-y-2 text-sm">
            {cardMoments.length === 0 ? (
              <p className="text-black/55">No card events recorded.</p>
            ) : (
              cardMoments.map((item, index) => (
                <div key={`${asText(item.type)}-${index}`} className="rounded-lg border border-black/10 bg-surface p-3">
                  <p className="font-semibold">{asText(item.type)}</p>
                  <p className="mt-1 text-xs text-black/55">{asText(item.ts)}</p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-xl border border-black/10 bg-white p-4">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/50">Evidence And Disputes</p>
          <div className="mt-3 space-y-2 text-sm">
            {evidence.map((item) => (
              <div key={asText(item.evidenceId)} className="rounded-lg border border-black/10 bg-surface p-3">
                <p className="font-semibold">{asText(item.type, "evidence")} | {asText(item.status, "unknown")}</p>
                <p className="mt-1 text-xs text-black/55">{asText(item.fileName)} | {String(item.sizeBytes ?? "-")} bytes</p>
              </div>
            ))}
            {disputes.map((item) => (
              <div key={asText(item.disputeId)} className="rounded-lg border border-black/10 bg-surface p-3">
                <p className="font-semibold">{asText(item.type, "dispute")} | {asText(item.status, "open")}</p>
                <p className="mt-1 text-xs text-black/55">{asText(item.description)}</p>
              </div>
            ))}
            {evidence.length === 0 && disputes.length === 0 ? (
              <p className="text-black/55">No evidence or disputes recorded.</p>
            ) : null}
          </div>
        </section>

        <section className="rounded-xl border border-black/10 bg-white p-4">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/50">Clues And Chat</p>
          <div className="mt-3 space-y-2 text-sm">
            {[...clues, ...messages].length === 0 ? (
              <p className="text-black/55">No clues or messages recorded.</p>
            ) : (
              [...clues, ...messages].map((item, index) => (
                <div key={`${asText(item.id, asText(item.messageId, String(index)))}`} className="rounded-lg border border-black/10 bg-surface p-3">
                  <p className="font-semibold">{asText(item.kind, item.messageId ? "chat" : "clue")}</p>
                  <p className="mt-1 text-black/75">{asText(item.text)}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <button
        type="button"
        disabled={Boolean(busyAction)}
        onClick={() => void onPrepareNextRound()}
        className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50"
      >
        {busyAction === "nextRound" ? "Preparing..." : "Prepare Next Round"}
      </button>
    </div>
  );
}
