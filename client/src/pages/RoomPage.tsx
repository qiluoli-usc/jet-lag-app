
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  debugAdvancePhase,
  fetchQuestionDefs,
  fetchRoomView,
  fetchSnapshot,
  joinRoom,
  leaveRoom,
  performRoundAction,
  setReady,
  startRound,
} from "../lib/api";
import { getProjectionPlayers, normalizeProjection } from "../lib/projection";
import { deriveCountdownTarget, normalizePhase, phaseLabel } from "../lib/phase";
import { PhaseRouter } from "../components/PhaseRouter";
import { RoomShell } from "../components/RoomShell";
import type {
  FrontPhase,
  QuestionDef,
  RoomEvent,
  RoomProjection,
  RoundAction,
  WsServerMessage,
} from "../types";

const MAX_EVENT_ITEMS = 220;

type JoinRole = "hider" | "seeker" | "observer";

function parseWsMessage(raw: unknown): WsServerMessage | null {
  if (typeof raw !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { type?: string };
    if (!parsed?.type) {
      return null;
    }
    return parsed as WsServerMessage;
  } catch {
    return null;
  }
}

function playerStorageKey(roomCode: string): string {
  return `jetlag-player:${roomCode}`;
}

function mergeProjection(base: RoomProjection | null, incoming: RoomProjection | null | undefined): RoomProjection {
  if (!incoming) {
    return normalizeProjection(base ?? {});
  }

  const merged: RoomProjection = {
    ...(base ?? {}),
    ...incoming,
  };

  if (base?.round || incoming.round) {
    merged.round = {
      ...(base?.round ?? {}),
      ...(incoming.round ?? {}),
    };
  }

  return normalizeProjection(merged);
}

export function RoomPage() {
  const params = useParams<{ code: string }>();
  const roomCode = useMemo(() => String(params.code ?? "").trim().toUpperCase(), [params.code]);

  const [projection, setProjection] = useState<RoomProjection | null>(null);
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [cursor, setCursor] = useState("0");
  const cursorRef = useRef("0");
  const refreshTimerRef = useRef<number | null>(null);

  const [questionDefs, setQuestionDefs] = useState<QuestionDef[]>([]);

  const [wsState, setWsState] = useState<"connecting" | "open" | "closed" | "error">("closed");
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState("Player");
  const [role, setRole] = useState<JoinRole>("seeker");

  const [nowMs, setNowMs] = useState(() => Date.now());

  const setCursorState = useCallback((nextCursor: string) => {
    cursorRef.current = nextCursor;
    setCursor(nextCursor);
  }, []);

  useEffect(() => {
    if (!roomCode) {
      setPlayerId(null);
      return;
    }
    const existing = window.localStorage.getItem(playerStorageKey(roomCode));
    setPlayerId(existing && existing.trim().length > 0 ? existing : null);
  }, [roomCode]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;

    const loadQuestionDefs = async () => {
      try {
        const response = await fetchQuestionDefs();
        if (!active) {
          return;
        }
        setQuestionDefs(Array.isArray(response.defs) ? response.defs : []);
      } catch {
        if (!active) {
          return;
        }
        setQuestionDefs([]);
      }
    };

    void loadQuestionDefs();

    return () => {
      active = false;
    };
  }, []);

  const refreshProjectionOnly = useCallback(async () => {
    if (!roomCode || !playerId) {
      return;
    }

    const roomView = await fetchRoomView(roomCode, playerId);
    setProjection((prev) => mergeProjection(prev, roomView.room));
  }, [roomCode, playerId]);

  const refreshSnapshotOnly = useCallback(async () => {
    if (!roomCode) {
      return;
    }

    const snapshot = await fetchSnapshot(roomCode, { limit: 160, playerId });
    setEvents(Array.isArray(snapshot.lastEvents) ? snapshot.lastEvents : []);
    setCursorState(snapshot.cursor);
    setProjection((prev) => mergeProjection(prev, snapshot.roomProjection));
  }, [roomCode, playerId, setCursorState]);

  const refreshAll = useCallback(async (viewerPlayerId?: string | null) => {
    if (!roomCode) {
      return;
    }

    const effectivePlayerId = String(viewerPlayerId ?? playerId ?? "").trim();
    const snapshot = await fetchSnapshot(roomCode, {
      limit: 160,
      playerId: effectivePlayerId || null,
    });

    let mergedProjection = mergeProjection(null, snapshot.roomProjection);
    if (effectivePlayerId) {
      try {
        const roomView = await fetchRoomView(roomCode, effectivePlayerId);
        mergedProjection = mergeProjection(mergedProjection, roomView.room);
      } catch {
        // non-blocking, snapshot stays usable
      }
    }

    setEvents(Array.isArray(snapshot.lastEvents) ? snapshot.lastEvents : []);
    setCursorState(snapshot.cursor);
    setProjection(mergedProjection);
    setError(null);
  }, [roomCode, playerId, setCursorState]);

  const scheduleRefreshProjection = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      return;
    }

    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      if (playerId) {
        void refreshProjectionOnly().catch(() => {
          // ignore transient errors
        });
        return;
      }
      void refreshSnapshotOnly().catch(() => {
        // ignore transient errors
      });
    }, 150);
  }, [playerId, refreshProjectionOnly, refreshSnapshotOnly]);

  useEffect(() => {
    void refreshAll().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Failed to load room snapshot");
    });
  }, [refreshAll]);

  useEffect(() => {
    if (!roomCode) {
      return undefined;
    }

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let stopped = false;

    const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;

    const connect = () => {
      if (stopped) {
        return;
      }
      setWsState("connecting");
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        if (stopped || !socket) {
          return;
        }
        setWsState("open");
        socket.send(
          JSON.stringify({
            type: "SUBSCRIBE",
            roomCode,
            playerId,
            sinceCursor: cursorRef.current,
          }),
        );
      };

      socket.onmessage = (messageEvent) => {
        const msg = parseWsMessage(messageEvent.data);
        if (!msg) {
          return;
        }

        if (msg.type === "SNAPSHOT") {
          setProjection((prev) => mergeProjection(prev, msg.projection));
          setCursorState(msg.cursor);
          setError(null);
          scheduleRefreshProjection();
          return;
        }

        if (msg.type === "EVENT_APPEND") {
          setEvents((prev) => [...prev, msg.event].slice(-MAX_EVENT_ITEMS));
          setCursorState(msg.cursor);
          scheduleRefreshProjection();
          return;
        }

        if (msg.type === "ERROR") {
          setError(msg.message);
        }
      };

      socket.onerror = () => {
        if (!stopped) {
          setWsState("error");
        }
      };

      socket.onclose = () => {
        if (stopped) {
          return;
        }
        setWsState("closed");
        reconnectTimer = window.setTimeout(connect, 1200);
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (socket) {
        socket.close();
      }
    };
  }, [roomCode, playerId, scheduleRefreshProjection, setCursorState]);

  const normalizedPhase = useMemo<FrontPhase>(() => normalizePhase(projection?.phase), [projection?.phase]);
  const phaseText = useMemo(() => phaseLabel(normalizedPhase), [normalizedPhase]);
  const countdown = useMemo(
    () => deriveCountdownTarget(normalizedPhase, events),
    [normalizedPhase, events],
  );

  const players = useMemo(() => getProjectionPlayers(projection), [projection]);
  const me = useMemo(() => players.find((item) => item.id === playerId) ?? null, [players, playerId]);
  const isReady = Boolean(me?.ready);

  const onJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!roomCode) {
      return;
    }

    setBusyAction("join");
    setError(null);
    try {
      const joined = await joinRoom(roomCode, {
        name: playerName.trim() || "Player",
        role,
        playerId: playerId ?? undefined,
      });
      const nextPlayerId = joined.player.id;
      window.localStorage.setItem(playerStorageKey(roomCode), nextPlayerId);
      setPlayerId(nextPlayerId);
      setRole((joined.player.role as JoinRole) ?? role);
      await refreshAll(nextPlayerId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Join failed");
    } finally {
      setBusyAction(null);
    }
  };

  const onToggleReady = async () => {
    if (!roomCode || !playerId) {
      return;
    }

    setBusyAction("ready");
    setError(null);
    try {
      await setReady(roomCode, { playerId, ready: !isReady });
      await refreshAll();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ready update failed");
    } finally {
      setBusyAction(null);
    }
  };

  const onStartRound = async () => {
    if (!roomCode || !playerId) {
      return;
    }

    setBusyAction("startRound");
    setError(null);
    try {
      await startRound(roomCode, { playerId });
      await refreshAll();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Start round failed");
    } finally {
      setBusyAction(null);
    }
  };

  const onLeaveRoom = async () => {
    if (!roomCode || !playerId) {
      if (roomCode) {
        window.localStorage.removeItem(playerStorageKey(roomCode));
      }
      setPlayerId(null);
      return;
    }

    setBusyAction("leaveRoom");
    setError(null);
    try {
      await leaveRoom(roomCode, { playerId });
    } catch {
      // ignore leave error, still clear local session
    } finally {
      window.localStorage.removeItem(playerStorageKey(roomCode));
      setPlayerId(null);
      setBusyAction(null);
      void refreshSnapshotOnly().catch(() => {
        // ignore
      });
    }
  };

  const onPerformRoundAction = useCallback(async (action: RoundAction, payload: Record<string, unknown>) => {
    if (!roomCode || !playerId) {
      setError("Join room first");
      return;
    }

    setBusyAction(action);
    setError(null);

    try {
      const result = await performRoundAction(roomCode, action, {
        ...payload,
        playerId,
      });
      setProjection((prev) => mergeProjection(prev, result.projection));
      if (result.cursor) {
        setCursorState(result.cursor);
      }
      scheduleRefreshProjection();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `${action} failed`);
    } finally {
      setBusyAction(null);
    }
  }, [playerId, roomCode, scheduleRefreshProjection, setCursorState]);

  const onDebugAdvance = useCallback(async (steps: number) => {
    if (!import.meta.env.DEV || !roomCode || !playerId) {
      return;
    }

    setBusyAction("devAdvancePhase");
    setError(null);
    try {
      await debugAdvancePhase(roomCode, {
        playerId,
        steps,
      });
      await refreshAll();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Advance phase failed");
    } finally {
      setBusyAction(null);
    }
  }, [playerId, refreshAll, roomCode]);

  if (!roomCode) {
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <p className="rounded-xl border border-signal/20 bg-rose-50 p-4 text-sm text-signal">Invalid room code.</p>
      </main>
    );
  }

  return (
    <main>
      <div className="mx-auto max-w-7xl px-4 pt-5 md:px-8">
        <Link to="/" className="text-sm font-semibold text-accent hover:underline">
          ← Back To Home
        </Link>
      </div>

      <RoomShell
        roomCode={roomCode}
        phaseLabel={phaseText}
        wsState={wsState}
        playerId={playerId}
        onRefresh={() => void refreshAll()}
        controls={
          playerId ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={onToggleReady}
                className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white transition enabled:hover:brightness-95 disabled:opacity-55"
              >
                {isReady ? "Cancel Ready" : "Set Ready"}
              </button>
              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={onStartRound}
                className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm font-semibold transition hover:bg-black hover:text-white disabled:opacity-55"
              >
                Start Round
              </button>
              {import.meta.env.DEV ? (
                <>
                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={() => void onDebugAdvance(1)}
                    className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white transition enabled:hover:brightness-95 disabled:opacity-55"
                  >
                    Next Phase
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={() => void onDebugAdvance(2)}
                    className="rounded-lg border border-amber-600 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-600 hover:text-white disabled:opacity-55"
                  >
                    +2 Phases
                  </button>
                </>
              ) : null}
              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={() => void onLeaveRoom()}
                className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm font-semibold transition hover:bg-black hover:text-white disabled:opacity-55"
              >
                Leave Room
              </button>
            </div>
          ) : (
            <form onSubmit={onJoin} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <input
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value)}
                className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring"
                placeholder="Your name"
              />
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as JoinRole)}
                className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring"
              >
                <option value="seeker">Seeker</option>
                <option value="hider">Hider</option>
                <option value="observer">Observer</option>
              </select>
              <button
                type="submit"
                disabled={Boolean(busyAction)}
                className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white transition enabled:hover:brightness-95 disabled:opacity-55"
              >
                {busyAction === "join" ? "Joining..." : "Join Room"}
              </button>
            </form>
          )
        }
        main={
          <div className="space-y-4">
            <PhaseRouter
              phase={normalizedPhase}
              countdown={countdown}
              nowMs={nowMs}
              summary={projection?.summary ?? projection?.round?.summary ?? null}
              projection={projection}
              events={events}
              roomCode={roomCode}
              playerId={playerId}
              busyAction={busyAction}
              questionDefs={questionDefs}
              onRefreshProjection={refreshAll}
              onPerformRoundAction={onPerformRoundAction}
            />
            <div className="rounded-xl border border-black/10 bg-surface p-4">
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-black/50">Projection Stats</p>
              <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                <p>
                  Cursor: <span className="font-mono font-semibold">{cursor}</span>
                </p>
                <p>
                  Total Events: <span className="font-mono font-semibold">{projection?.counters?.total ?? events.length}</span>
                </p>
                <p>
                  Round: <span className="font-mono font-semibold">{projection?.round?.number ?? projection?.roundNumber ?? "-"}</span>
                </p>
                <p>
                  Pending Q: <span className="font-mono font-semibold">{projection?.round?.pendingQuestion?.id ?? projection?.pendingQuestionId ?? "-"}</span>
                </p>
              </div>
            </div>
          </div>
        }
        side={
          <div className="space-y-4">
            <section>
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-black/50">Players</p>
              <ul className="mt-2 grid gap-2">
                {players.length === 0 ? (
                  <li className="rounded-lg border border-dashed border-black/20 px-3 py-2 text-sm text-black/55">
                    No players yet
                  </li>
                ) : (
                  players.map((player) => (
                    <li key={player.id} className="rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span>{player.name ?? player.id.slice(-6)} ({player.role ?? "unknown"})</span>
                        <span className={player.ready ? "text-emerald-700" : "text-black/60"}>
                          {player.ready ? "ready" : "not ready"}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-black/55">
                        {player.id} | loc {Number.isFinite(Number(player.location?.lat)) ? `${Number(player.location?.lat).toFixed(5)},${Number(player.location?.lng).toFixed(5)}` : "-"}
                      </p>
                    </li>
                  ))
                )}
              </ul>
            </section>

            <section>
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-black/50">Event Stream</p>
              <ul className="mt-2 max-h-[460px] space-y-2 overflow-auto pr-1">
                {[...events].reverse().map((event) => (
                  <li key={event.id} className="rounded-lg border border-black/10 bg-surface px-3 py-2 text-xs">
                    <p className="font-mono text-[11px] text-black/50">{new Date(event.ts).toLocaleTimeString()}</p>
                    <p className="mt-1 font-semibold text-black/85">{event.type}</p>
                    <p className="mt-1 font-mono text-[11px] text-black/55">
                      {JSON.stringify(event.data).slice(0, 180)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        }
      />

      {error ? (
        <div className="mx-auto mt-3 max-w-7xl px-4 pb-8 md:px-8">
          <p className="rounded-xl border border-signal/20 bg-rose-50 px-3 py-2 text-sm font-medium text-signal">
            {error}
          </p>
        </div>
      ) : null}
    </main>
  );
}
