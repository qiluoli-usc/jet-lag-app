interface SummaryPanelProps {
  summary: Record<string, unknown> | null;
}

function textOrDash(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value : "-";
}

export function SummaryPanel({ summary }: SummaryPanelProps) {
  return (
    <div className="rounded-xl border border-black/10 bg-surface p-5">
      <p className="font-mono text-xs uppercase tracking-[0.24em] text-black/50">Summary</p>
      <h2 className="mt-2 font-heading text-2xl font-bold">Round Resolved</h2>
      <dl className="mt-4 grid gap-3 rounded-lg border border-black/10 bg-white p-4 text-sm">
        <div>
          <dt className="font-mono text-xs uppercase tracking-[0.2em] text-black/45">Winner</dt>
          <dd className="mt-1 font-semibold text-black/85">{textOrDash(summary?.winner)}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs uppercase tracking-[0.2em] text-black/45">Reason</dt>
          <dd className="mt-1 font-semibold text-black/85">{textOrDash(summary?.reason)}</dd>
        </div>
      </dl>
    </div>
  );
}
