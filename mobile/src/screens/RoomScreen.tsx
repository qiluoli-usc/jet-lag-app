import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  debugAdvancePhase,
  fetchTransitPacks,
  fetchQuestionDefs,
  fetchRoomView,
  fetchSnapshot,
  leaveRoom,
  nextRound,
  performRoundAction,
  setReady,
  startRound,
  updateRoomConfig,
} from "../lib/api";
import { getAuthSession } from "../lib/authSession";
import { applyEventToProjection, getProjectionPlayers, normalizeProjection } from "../lib/projection";
import { PhaseRouter } from "../components/PhaseRouter";
import type {
  Projection,
  QuestionDef,
  Role,
  RoomEvent,
  RoundAction,
  TransitPackSummary,
  WsMessage,
} from "../types";

interface RoomScreenProps {
  roomCode: string;
  playerId: string;
  playerName: string;
  role: Role;
  httpBaseUrl: string;
  wsBaseUrl: string;
  onBackHome: () => void;
}

const MAX_EVENT_ITEMS = 220;

function parseWsMessage(raw: unknown): WsMessage | null {
  if (typeof raw !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { type?: string };
    if (!parsed?.type) {
      return null;
    }
    return parsed as WsMessage;
  } catch {
    return null;
  }
}

function mergeProjection(base: Projection | null, incoming: Projection | null | undefined): Projection {
  if (!incoming) {
    return normalizeProjection(base ?? {});
  }

  const merged: Projection = {
    ...(base ?? {}),
    ...incoming,
  };

  if (base?.round || incoming.round) {
    merged.round = {
      ...(base?.round ?? {}),
      ...(incoming.round ?? {}),
    };
  }

  if (incoming.phase) {
    merged.phase = incoming.phase;
    merged.round = {
      ...(merged.round ?? {}),
      phase: incoming.phase,
    };
  }

  return normalizeProjection(merged);
}

export function RoomScreen({
  roomCode,
  playerId,
  playerName,
  role,
  httpBaseUrl,
  wsBaseUrl,
  onBackHome,
}: RoomScreenProps) {
  const [projection, setProjection] = useState<Projection | null>(null);
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const cursorRef = useRef("0");

  const [questionDefs, setQuestionDefs] = useState<QuestionDef[]>([]);
  const [transitPacks, setTransitPacks] = useState<TransitPackSummary[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  const setCursorState = useCallback((nextCursor: string) => {
    cursorRef.current = nextCursor;
  }, []);

  const refreshProjectionOnly = useCallback(async () => {
    const roomView = await fetchRoomView(httpBaseUrl, roomCode, playerId);
    setProjection((prev) => mergeProjection(prev, roomView.room));
  }, [httpBaseUrl, roomCode, playerId]);

  const refreshAll = useCallback(async () => {
    const [snapshot, roomView] = await Promise.all([
      fetchSnapshot(httpBaseUrl, roomCode, playerId),
      fetchRoomView(httpBaseUrl, roomCode, playerId),
    ]);

    setEvents(Array.isArray(snapshot.lastEvents) ? snapshot.lastEvents : []);
    setCursorState(snapshot.cursor);
    setProjection(mergeProjection(snapshot.roomProjection, roomView.room));
  }, [httpBaseUrl, roomCode, playerId, setCursorState]);

  const scheduleProjectionRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      return;
    }

    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshProjectionOnly().catch(() => {
        // ignore transient refresh errors
      });
    }, 180);
  }, [refreshProjectionOnly]);

  useEffect(() => {
    stoppedRef.current = false;
    setLoading(true);
    setError(null);

    const init = async () => {
      try {
        await refreshAll();
        const [defsResult, transitResult] = await Promise.allSettled([
          fetchQuestionDefs(httpBaseUrl),
          fetchTransitPacks(httpBaseUrl),
        ]);

        if (defsResult.status === "fulfilled") {
          setQuestionDefs(Array.isArray(defsResult.value.defs) ? defsResult.value.defs : []);
        } else {
          setQuestionDefs([]);
        }

        if (transitResult.status === "fulfilled") {
          setTransitPacks(Array.isArray(transitResult.value.packs) ? transitResult.value.packs : []);
        } else {
          setTransitPacks([]);
        }
        setLoading(false);
      } catch (caught) {
        setLoading(false);
        setError(caught instanceof Error ? caught.message : "Failed to load room snapshot");
      }
    };

    void init();

    return () => {
      stoppedRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [httpBaseUrl, refreshAll]);

  useEffect(() => {
    if (loading) {
      return;
    }

    const connect = () => {
      if (stoppedRef.current) {
        return;
      }

      const ws = new WebSocket(wsBaseUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (stoppedRef.current) {
          return;
        }

        void (async () => {
          const session = await getAuthSession();
          if (stoppedRef.current || ws.readyState !== WebSocket.OPEN) {
            return;
          }

          ws.send(
            JSON.stringify({
              type: "SUBSCRIBE",
              roomCode,
              playerId,
              sinceCursor: cursorRef.current,
              token: session?.token ?? null,
            }),
          );
        })();
      };

      ws.onmessage = (event) => {
        const msg = parseWsMessage(event.data);
        if (!msg) {
          return;
        }

        if (msg.type === "SNAPSHOT") {
          setProjection((prev) => mergeProjection(prev, msg.projection));
          setCursorState(msg.cursor);
          setError(null);
          scheduleProjectionRefresh();
          return;
        }

        if (msg.type === "EVENT_APPEND") {
          setCursorState(msg.cursor);
          setEvents((prev) => [...prev, msg.event].slice(-MAX_EVENT_ITEMS));
          setProjection((prev) => applyEventToProjection(prev, msg.event));
          scheduleProjectionRefresh();
          return;
        }

        if (msg.type === "ERROR") {
          setError(msg.message);
        }
      };

      ws.onerror = () => {
        // rely on onclose + error banner path for user feedback
      };

      ws.onclose = () => {
        if (stoppedRef.current) {
          return;
        }
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, 1200);
      };
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [loading, roomCode, scheduleProjectionRefresh, setCursorState, wsBaseUrl]);

  const runRoundAction = useCallback(async (action: RoundAction, payload: Record<string, unknown>) => {
    setBusyAction(action);
    setError(null);

    try {
      const result = await performRoundAction(httpBaseUrl, roomCode, action, {
        ...payload,
        playerId,
      });
      setProjection((prev) => mergeProjection(prev, result.projection));
      if (result.cursor) {
        setCursorState(result.cursor);
      }
      scheduleProjectionRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `${action} failed`);
    } finally {
      setBusyAction(null);
    }
  }, [httpBaseUrl, playerId, roomCode, scheduleProjectionRefresh, setCursorState]);

  const players = useMemo(() => getProjectionPlayers(projection), [projection]);
  const me = useMemo(() => players.find((item) => item.id === playerId) ?? null, [players, playerId]);
  const isReady = Boolean(me?.ready);

  const handleToggleReady = useCallback(async () => {
    setBusyAction("ready");
    setError(null);
    try {
      await setReady(httpBaseUrl, roomCode, {
        playerId,
        ready: !isReady,
      });
      await refreshAll();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ready failed");
    } finally {
      setBusyAction(null);
    }
  }, [httpBaseUrl, roomCode, playerId, isReady, refreshAll]);

  const handleStartRound = useCallback(async () => {
    setBusyAction("startRound");
    setError(null);
    try {
      await startRound(httpBaseUrl, roomCode, {
        playerId,
      });
      await refreshAll();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "startRound failed");
    } finally {
      setBusyAction(null);
    }
  }, [httpBaseUrl, roomCode, playerId, refreshAll]);

  const handlePrepareNextRound = useCallback(async () => {
    setBusyAction("nextRound");
    setError(null);
    try {
      await nextRound(httpBaseUrl, roomCode, {
        playerId,
      });
      await refreshAll();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "nextRound failed");
    } finally {
      setBusyAction(null);
    }
  }, [httpBaseUrl, playerId, refreshAll, roomCode]);

  const handleUpdateRoomConfig = useCallback(async (
    payload: {
      transitPackId?: string | null;
      borderPolygonGeoJSON?: Record<string, unknown> | null;
      hidingAreaGeoJSON?: Record<string, unknown> | null;
    },
  ) => {
    setBusyAction("config");
    setError(null);
    try {
      const result = await updateRoomConfig(httpBaseUrl, roomCode, {
        playerId,
        transitPackId: payload.transitPackId,
        borderPolygonGeoJSON: payload.borderPolygonGeoJSON,
        hidingAreaGeoJSON: payload.hidingAreaGeoJSON,
      });
      setProjection((prev) => mergeProjection(prev, result.room));
      scheduleProjectionRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "config update failed");
    } finally {
      setBusyAction(null);
    }
  }, [httpBaseUrl, playerId, roomCode, scheduleProjectionRefresh]);

  const handleBackPress = useCallback(async () => {
    setBusyAction("leave");
    try {
      await leaveRoom(httpBaseUrl, roomCode, {
        playerId,
      });
    } catch {
      // ignore leave errors when navigating away
    }
    setBusyAction(null);
    onBackHome();
  }, [httpBaseUrl, roomCode, playerId, onBackHome]);

  const handleDebugAdvancePhase = useCallback(async (steps = 1) => {
    if (!__DEV__) {
      return;
    }

    setBusyAction("devAdvancePhase");
    setError(null);
    try {
      await debugAdvancePhase(httpBaseUrl, roomCode, {
        playerId,
        steps,
      });
      await refreshAll();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "dev phase advance failed");
    } finally {
      setBusyAction(null);
    }
  }, [httpBaseUrl, roomCode, playerId, refreshAll]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerMeta}>
          <Text style={styles.roomCode}>{roomCode}</Text>
          <Text style={styles.metaText}>{playerName} / {role} / {playerId.slice(-6)}</Text>
        </View>
        <View style={styles.headerActions}>
          {__DEV__ ? (
            <>
              <Pressable
                style={[styles.devButton, busyAction ? styles.buttonDisabled : null]}
                disabled={Boolean(busyAction)}
                onPress={() => void handleDebugAdvancePhase(1)}
              >
                <Text style={styles.devButtonText}>Next Phase</Text>
              </Pressable>
              <Pressable
                style={[styles.devGhostButton, busyAction ? styles.buttonDisabled : null]}
                disabled={Boolean(busyAction)}
                onPress={() => void handleDebugAdvancePhase(2)}
              >
                <Text style={styles.devGhostButtonText}>+2 Phases</Text>
              </Pressable>
            </>
          ) : null}
          <Pressable style={styles.refreshButton} onPress={() => void refreshAll()}>
            <Text style={styles.refreshButtonText}>Refresh</Text>
          </Pressable>
          <Pressable style={styles.backButton} onPress={() => void handleBackPress()}>
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.badgeRow}>
        <Text style={styles.badge}>Ready {isReady ? "YES" : "NO"}</Text>
        <Text style={styles.badge}>Map {String(projection?.mapProvider ?? "-")}</Text>
        <Text style={styles.badge}>Transit {String(projection?.transitPackId ?? "-")}</Text>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color="#0a5f66" />
          <Text style={styles.loadingText}>Loading snapshot...</Text>
        </View>
      ) : (
        <ScrollView style={styles.bodyScroll} contentContainerStyle={styles.bodyInner}>
          <PhaseRouter
            projection={projection}
            events={events}
            questionDefs={questionDefs}
            roomCode={roomCode}
            httpBaseUrl={httpBaseUrl}
            playerId={playerId}
            busyAction={busyAction}
            transitPacks={transitPacks}
            onRefreshProjection={refreshAll}
            onToggleReady={handleToggleReady}
            onStartRound={handleStartRound}
            onPrepareNextRound={handlePrepareNextRound}
            onUpdateRoomConfig={handleUpdateRoomConfig}
            onPerformRoundAction={runRoundAction}
          />

          <View style={styles.eventBox}>
            <Text style={styles.eventTitle}>Recent Events ({events.length})</Text>
            {[...events].slice(-8).reverse().map((eventItem) => (
              <View key={eventItem.id} style={styles.eventItem}>
                <Text style={styles.eventType}>{eventItem.type}</Text>
                <Text style={styles.eventTs}>{new Date(eventItem.ts).toLocaleTimeString()}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 14,
    gap: 10,
  },
  header: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d8d6ce",
    padding: 12,
    flexDirection: "column",
    gap: 12,
  },
  headerMeta: {},
  roomCode: {
    fontSize: 24,
    fontWeight: "800",
    color: "#1f1f1f",
    letterSpacing: 1,
  },
  metaText: {
    marginTop: 4,
    fontSize: 12,
    color: "#595959",
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-start",
  },
  refreshButton: {
    borderRadius: 10,
    backgroundColor: "#0a5f66",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  refreshButtonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  devButton: {
    borderRadius: 10,
    backgroundColor: "#cc8a00",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  devButtonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  devGhostButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#cc8a00",
    backgroundColor: "#fff7e5",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  devGhostButtonText: {
    color: "#9b6700",
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  backButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#3e3e3e",
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: "#ffffff",
  },
  backButtonText: {
    color: "#2a2a2a",
    fontWeight: "700",
  },
  badgeRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#ebe9de",
    color: "#343434",
    fontSize: 12,
    fontWeight: "700",
  },
  loadingWrap: {
    marginTop: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flex: 1,
  },
  loadingText: {
    color: "#4a4a4a",
    fontSize: 13,
  },
  bodyScroll: {
    flex: 1,
  },
  bodyInner: {
    gap: 10,
    paddingBottom: 16,
  },
  eventBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d8d6ce",
    backgroundColor: "#f9f9f5",
    padding: 10,
    gap: 6,
  },
  eventTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#4f4f4f",
    textTransform: "uppercase",
  },
  eventItem: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#d5d3cb",
    paddingBottom: 4,
  },
  eventType: {
    fontSize: 12,
    fontWeight: "700",
    color: "#222222",
  },
  eventTs: {
    fontSize: 11,
    color: "#6b6b6b",
  },
  errorBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2a6ad",
    backgroundColor: "#fbeef0",
    padding: 10,
  },
  errorText: {
    color: "#b52b3a",
    fontSize: 12,
    fontWeight: "600",
  },
});
