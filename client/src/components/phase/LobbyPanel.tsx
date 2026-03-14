export function LobbyPanel() {
  return (
    <div className="rounded-xl border border-black/10 bg-surface p-5">
      <p className="font-mono text-xs uppercase tracking-[0.24em] text-black/50">Lobby</p>
      <h2 className="mt-2 font-heading text-2xl font-bold">Waiting For Players</h2>
      <p className="mt-2 text-sm text-black/70">
        Join the room, assign roles, and mark everyone ready. The phase will jump automatically once conditions are
        met.
      </p>
    </div>
  );
}
