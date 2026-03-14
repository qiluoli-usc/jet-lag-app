interface HidingPanelProps {
  countdownText: string | null;
}

export function HidingPanel({ countdownText }: HidingPanelProps) {
  return (
    <div className="rounded-xl border border-black/10 bg-surface p-5">
      <p className="font-mono text-xs uppercase tracking-[0.24em] text-black/50">Hiding</p>
      <h2 className="mt-2 font-heading text-2xl font-bold">Hider On The Move</h2>
      <p className="mt-2 text-sm text-black/70">
        Hide timer is running. As soon as it reaches zero, the room transitions into seeking.
      </p>
      <div className="mt-4 rounded-lg bg-accent px-4 py-3 font-mono text-lg font-semibold text-white">
        {countdownText ?? "Timer unavailable"}
      </div>
    </div>
  );
}
