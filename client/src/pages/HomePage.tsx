import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom } from "../lib/api";

export function HomePage() {
  const navigate = useNavigate();
  const [createName, setCreateName] = useState("Prototype Room");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const created = await createRoom({ name: createName.trim() || "Prototype Room" });
      const code = String(created.code ?? created.room.code ?? "").trim().toUpperCase();
      if (!code) {
        throw new Error("Server did not return room code");
      }
      navigate(`/room/${encodeURIComponent(code)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Create room failed");
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setError("Room code is required");
      return;
    }
    navigate(`/room/${encodeURIComponent(code)}`);
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 md:px-8">
      <section className="grid gap-6 md:grid-cols-[1.25fr_0.75fr]">
        <article className="grain rounded-3xl border border-black/10 bg-white/85 p-8 shadow-soft backdrop-blur-sm">
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-black/45">Jet Lag App Console</p>
          <h1 className="mt-3 max-w-xl font-heading text-4xl font-bold leading-tight md:text-5xl">
            Create or Join A Room In Seconds
          </h1>
          <p className="mt-4 max-w-xl text-sm text-black/70 md:text-base">
            This frontend consumes your existing HTTP and WebSocket backend. Open two browsers, join the same room,
            and both pages will track phase and event updates in realtime.
          </p>
        </article>

        <article className="rounded-3xl border border-black/10 bg-white/85 p-6 shadow-soft">
          <h2 className="font-heading text-xl font-bold">Room Entry</h2>
          <div className="mt-4 grid gap-5">
            <form onSubmit={handleCreate} className="grid gap-3 rounded-xl border border-black/10 bg-surface p-4">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/45">Create</p>
              <input
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="Room name"
                className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white transition enabled:hover:brightness-95 disabled:opacity-50"
              >
                {busy ? "Creating..." : "Create Room"}
              </button>
            </form>

            <form onSubmit={handleJoin} className="grid gap-3 rounded-xl border border-black/10 bg-surface p-4">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/45">Join</p>
              <input
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
                placeholder="Room code"
                className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm uppercase outline-none ring-accent/40 focus:ring"
              />
              <button
                type="submit"
                className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm font-semibold transition hover:bg-black hover:text-white"
              >
                Open Room
              </button>
            </form>
          </div>
          {error ? <p className="mt-4 text-sm font-medium text-signal">{error}</p> : null}
        </article>
      </section>
    </main>
  );
}
