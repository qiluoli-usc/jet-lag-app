
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ACTION_CAPABILITY_KEY,
  getPendingQuestion,
  getProjectionAllowedActions,
  getProjectionCapabilities,
  getProjectionHand,
  getProjectionPlayers,
} from "../../lib/projection";
import {
  addMapAnnotation,
  searchRoomPlaces,
  toPlaceCenter,
  updatePlayerLocation,
} from "../../lib/api";
import type {
  MapPlace,
  QuestionDef,
  RoomEvent,
  RoomProjection,
  RoundAction,
} from "../../types";

interface SeekingPanelProps {
  countdownText: string | null;
  projection: RoomProjection | null;
  events: RoomEvent[];
  roomCode: string;
  playerId: string;
  busyAction: string | null;
  questionDefs: QuestionDef[];
  onPerformRoundAction: (action: RoundAction, payload: Record<string, unknown>) => Promise<void>;
  onRefreshProjection: () => Promise<void>;
}

type TabKey = "map" | "qa" | "cards" | "dice" | "catch" | "log";

const TAB_ITEMS: Array<{ key: TabKey; label: string }> = [
  { key: "map", label: "Map" },
  { key: "qa", label: "Q&A" },
  { key: "cards", label: "Cards" },
  { key: "dice", label: "Dice" },
  { key: "catch", label: "Catch" },
  { key: "log", label: "Log" },
];

const FALLBACK_QUESTION_DEFS: QuestionDef[] = [
  { key: "matching", label: "Matching" },
  { key: "measuring", label: "Measuring" },
  { key: "radar", label: "Radar" },
  { key: "thermometer", label: "Thermometer" },
  { key: "photo", label: "Photo" },
  { key: "tentacles", label: "Tentacles" },
];

const ACTION_REASON_FALLBACK: Record<RoundAction, string> = {
  ask: "Ask unavailable (needs seeker in Seeking/EndGame and no pending question)",
  answer: "Answer unavailable (needs hider and pending question)",
  drawCard: "Draw unavailable (needs hider in active round)",
  castCurse: "Cast unavailable (needs hider with a curse card)",
  rollDice: "Roll unavailable (round paused or phase restricted)",
  claimCatch: "Catch unavailable (needs seeker in active round)",
};

const LOCATION_REPORT_INTERVAL_MS = 4000;

function shortJson(value: unknown): string {
  try {
    const encoded = JSON.stringify(value);
    return encoded.length > 180 ? `${encoded.slice(0, 180)}...` : encoded;
  } catch {
    return "{...}";
  }
}

function parsePositiveInt(input: string, fallbackValue: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(input).trim(), 10);
  if (!Number.isInteger(parsed)) {
    return fallbackValue;
  }
  return Math.max(min, Math.min(max, parsed));
}

function actionReasonByCapability(action: RoundAction, capabilities: Record<string, unknown>): string {
  const capabilityKey = ACTION_CAPABILITY_KEY[action];
  if (capabilityKey && capabilities[capabilityKey] === false) {
    return ACTION_REASON_FALLBACK[action];
  }
  return ACTION_REASON_FALLBACK[action];
}

function coordsText(lat: unknown, lng: unknown): string {
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) {
    return "-";
  }
  return `${nLat.toFixed(5)}, ${nLng.toFixed(5)}`;
}

export function SeekingPanel({
  countdownText,
  projection,
  events,
  roomCode,
  playerId,
  busyAction,
  questionDefs,
  onPerformRoundAction,
  onRefreshProjection,
}: SeekingPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("map");

  const defs = questionDefs.length > 0 ? questionDefs : FALLBACK_QUESTION_DEFS;
  const [askCategory, setAskCategory] = useState(defs[0]?.key ?? "matching");
  const [askPrompt, setAskPrompt] = useState("");
  const [answerValue, setAnswerValue] = useState("");

  const [drawCountText, setDrawCountText] = useState("1");
  const [selectedCurseCardId, setSelectedCurseCardId] = useState("");
  const [selectedCurseTargetId, setSelectedCurseTargetId] = useState("");

  const [diceSidesText, setDiceSidesText] = useState("6");
  const [diceCountText, setDiceCountText] = useState("1");
  const [dicePurpose, setDicePurpose] = useState("web_action");

  const [catchTargetId, setCatchTargetId] = useState("");

  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);

  const [poiQuery, setPoiQuery] = useState("");
  const [poiLoading, setPoiLoading] = useState(false);
  const [poiError, setPoiError] = useState<string | null>(null);
  const [poiResults, setPoiResults] = useState<MapPlace[]>([]);

  const [draftPolygon, setDraftPolygon] = useState<Array<{ lat: number; lng: number }>>([]);
  const [annotationLabel, setAnnotationLabel] = useState("possible_area");
  const [mapBusy, setMapBusy] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const players = useMemo(() => getProjectionPlayers(projection), [projection]);
  const hand = useMemo(() => getProjectionHand(projection), [projection]);
  const capabilities = useMemo(() => getProjectionCapabilities(projection), [projection]);
  const allowedActions = useMemo(() => getProjectionAllowedActions(projection), [projection]);
  const pendingQuestion = useMemo(() => getPendingQuestion(projection), [projection]);

  const me = useMemo(
    () => players.find((item) => item.id === playerId) ?? null,
    [players, playerId],
  );
  const meRole = String(me?.role ?? "").toLowerCase();
  const canReportLocation = meRole === "seeker" || meRole === "hider";
  const canDrawMap = meRole === "seeker" && capabilities.canDrawMap !== false;

  const seekerPlayers = useMemo(
    () => players.filter((item) => item.role === "seeker"),
    [players],
  );
  const hiderPlayers = useMemo(
    () => players.filter((item) => item.role === "hider"),
    [players],
  );
  const curseCards = useMemo(
    () => hand.filter((card) => String(card.type ?? "") === "curse"),
    [hand],
  );

  const mapAnnotations = useMemo(() => {
    return Array.isArray(projection?.mapAnnotations) ? projection.mapAnnotations : [];
  }, [projection?.mapAnnotations]);

  useEffect(() => {
    if (!defs.some((item) => item.key === askCategory)) {
      setAskCategory(defs[0]?.key ?? "matching");
    }
  }, [defs, askCategory]);

  useEffect(() => {
    if (!selectedCurseCardId) {
      const first = curseCards[0];
      if (first?.id) {
        setSelectedCurseCardId(String(first.id));
      }
      return;
    }

    const exists = curseCards.some((card) => String(card.id ?? "") === selectedCurseCardId);
    if (!exists) {
      setSelectedCurseCardId("");
    }
  }, [curseCards, selectedCurseCardId]);

  useEffect(() => {
    if (!selectedCurseTargetId) {
      const first = seekerPlayers[0];
      if (first?.id) {
        setSelectedCurseTargetId(first.id);
      }
      return;
    }

    const exists = seekerPlayers.some((player) => player.id === selectedCurseTargetId);
    if (!exists) {
      setSelectedCurseTargetId("");
    }
  }, [seekerPlayers, selectedCurseTargetId]);

  useEffect(() => {
    if (!catchTargetId) {
      const first = hiderPlayers[0];
      if (first?.id) {
        setCatchTargetId(first.id);
      }
      return;
    }

    const exists = hiderPlayers.some((player) => player.id === catchTargetId);
    if (!exists) {
      setCatchTargetId("");
    }
  }, [hiderPlayers, catchTargetId]);

  const reportLocation = useCallback(async () => {
    if (!canReportLocation || !navigator.geolocation) {
      return;
    }

    setLocationBusy(true);
    setLocationError(null);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 1000,
        });
      });

      const lat = Number(position.coords.latitude);
      const lng = Number(position.coords.longitude);
      const accuracy = Number(position.coords.accuracy ?? 0);
      setMyLocation({ lat, lng, accuracy });

      await updatePlayerLocation(roomCode, {
        playerId,
        lat,
        lng,
        accuracy,
      });
    } catch (caught) {
      setLocationError(caught instanceof Error ? caught.message : "Location update failed");
    } finally {
      setLocationBusy(false);
    }
  }, [canReportLocation, playerId, roomCode]);

  useEffect(() => {
    if (!canReportLocation) {
      return undefined;
    }
    void reportLocation();
    const timer = window.setInterval(() => {
      void reportLocation();
    }, LOCATION_REPORT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [canReportLocation, reportLocation]);

  const handleSearchPlaces = useCallback(async () => {
    setPoiLoading(true);
    setPoiError(null);
    try {
      const center = myLocation ? { lat: myLocation.lat, lng: myLocation.lng } : null;
      const response = await searchRoomPlaces(roomCode, {
        playerId,
        query: poiQuery.trim(),
        center,
        radiusM: 5000,
      });
      const places = Array.isArray(response.places?.places) ? response.places.places : [];
      setPoiResults(places);
    } catch (caught) {
      setPoiError(caught instanceof Error ? caught.message : "POI search failed");
    } finally {
      setPoiLoading(false);
    }
  }, [myLocation, playerId, poiQuery, roomCode]);

  const handleSavePolygon = useCallback(async () => {
    if (!canDrawMap || draftPolygon.length < 3 || mapBusy) {
      return;
    }

    setMapBusy(true);
    setMapError(null);
    try {
      await addMapAnnotation(roomCode, {
        playerId,
        layer: "possible_area",
        geometryType: "polygon",
        geometry: {
          vertices: draftPolygon.map((point) => ({
            lat: Number(point.lat.toFixed(6)),
            lng: Number(point.lng.toFixed(6)),
          })),
        },
        label: annotationLabel.trim() || "possible_area",
      });
      setDraftPolygon([]);
      await onRefreshProjection();
    } catch (caught) {
      setMapError(caught instanceof Error ? caught.message : "Failed to save polygon");
    } finally {
      setMapBusy(false);
    }
  }, [annotationLabel, canDrawMap, draftPolygon, mapBusy, onRefreshProjection, playerId, roomCode]);

  const baseActionReason = (action: RoundAction): string | null => {
    if (busyAction) {
      return busyAction === action ? "Submitting..." : "Another action is in progress";
    }

    if (!allowedActions.includes(action)) {
      return actionReasonByCapability(action, capabilities);
    }

    return null;
  };

  const askBlockedCategories = Array.isArray(capabilities.blockedQuestionCategories)
    ? capabilities.blockedQuestionCategories.map((item) => String(item).toLowerCase())
    : [];

  const askReason =
    baseActionReason("ask") ??
    (!askCategory ? "Select a question category" : null) ??
    (askBlockedCategories.includes(String(askCategory).toLowerCase())
      ? `Category blocked by curse: ${askCategory}`
      : null);

  const pendingQuestionId = typeof pendingQuestion?.id === "string" ? pendingQuestion.id : "";
  const answerReason =
    baseActionReason("answer") ??
    (!pendingQuestionId ? "No pending question to answer" : null) ??
    (!answerValue.trim() ? "Answer text is required" : null);

  const drawCount = parsePositiveInt(drawCountText, 1, 1, 3);
  const drawReason = baseActionReason("drawCard");

  const castReason =
    baseActionReason("castCurse") ??
    (!selectedCurseCardId ? "No curse card selected" : null) ??
    (!selectedCurseTargetId ? "No seeker target selected" : null);

  const diceSides = parsePositiveInt(diceSidesText, 6, 2, 100);
  const diceCount = parsePositiveInt(diceCountText, 1, 1, 5);
  const diceReason = baseActionReason("rollDice");

  const catchReason =
    baseActionReason("claimCatch") ??
    (!catchTargetId ? "No hider target selected" : null);

  const onAsk = async () => {
    if (askReason) {
      return;
    }
    await onPerformRoundAction("ask", {
      playerId,
      category: askCategory,
      prompt: askPrompt.trim() || "Where are you now?",
    });
    setAskPrompt("");
  };

  const onAnswer = async () => {
    if (answerReason || !pendingQuestionId) {
      return;
    }
    await onPerformRoundAction("answer", {
      playerId,
      questionId: pendingQuestionId,
      kind: "text",
      value: answerValue.trim(),
      autoVerified: true,
    });
    setAnswerValue("");
  };

  const onDraw = async () => {
    if (drawReason) {
      return;
    }
    await onPerformRoundAction("drawCard", {
      playerId,
      count: drawCount,
    });
  };

  const onCastCurse = async () => {
    if (castReason) {
      return;
    }
    await onPerformRoundAction("castCurse", {
      playerId,
      cardId: selectedCurseCardId,
      targetPlayerId: selectedCurseTargetId,
    });
  };

  const onRollDice = async () => {
    if (diceReason) {
      return;
    }
    await onPerformRoundAction("rollDice", {
      playerId,
      sides: diceSides,
      count: diceCount,
      purpose: dicePurpose.trim() || "web_action",
    });
  };

  const onClaimCatch = async () => {
    if (catchReason) {
      return;
    }
    await onPerformRoundAction("claimCatch", {
      playerId,
      targetPlayerId: catchTargetId,
      method: "distance",
      visualConfirmed: true,
    });
  };

  return (
    <div className="rounded-xl border border-black/10 bg-surface p-5">
      <p className="font-mono text-xs uppercase tracking-[0.24em] text-black/50">Seeking</p>
      <h2 className="mt-2 font-heading text-2xl font-bold">Seekers Active</h2>
      <p className="mt-2 text-sm text-black/70">
        Web now matches mobile's stage actions and map/location flow. Keep this page open for realtime updates.
      </p>
      <div className="mt-4 rounded-lg bg-signal px-4 py-3 font-mono text-lg font-semibold text-white">
        {countdownText ?? "Timer unavailable"}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {TAB_ITEMS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
              activeTab === tab.key
                ? "border-accent bg-accent/10 text-accent"
                : "border-black/15 bg-white text-black/70"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "map" ? (
        <section className="mt-4 space-y-3 rounded-xl border border-black/10 bg-white p-4">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/50">Map + Location (Web)</p>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-black/5 px-3 py-1">Role {meRole || "observer"}</span>
            <span className="rounded-full bg-black/5 px-3 py-1">Vertices {draftPolygon.length}</span>
            <span className="rounded-full bg-black/5 px-3 py-1">Saved {mapAnnotations.length}</span>
          </div>

          <div className="rounded-lg border border-black/10 bg-surface p-3 text-xs">
            <p className="font-semibold">This web build uses coordinate workflow for map actions.</p>
            <p className="mt-1 text-black/65">
              Use browser location, search POI, add vertices, then submit polygon. Saved polygons come from event replay.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canReportLocation || locationBusy}
              onClick={() => void reportLocation()}
              className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {locationBusy ? "Locating..." : "Report Location"}
            </button>
            <button
              type="button"
              disabled={!myLocation || !canDrawMap}
              onClick={() => {
                if (!myLocation) {
                  return;
                }
                setDraftPolygon((prev) => [...prev, { lat: myLocation.lat, lng: myLocation.lng }].slice(-30));
              }}
              className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Add My Point
            </button>
            <button
              type="button"
              disabled={!canDrawMap || draftPolygon.length === 0}
              onClick={() => setDraftPolygon((prev) => prev.slice(0, -1))}
              className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Undo
            </button>
            <button
              type="button"
              disabled={!canDrawMap || draftPolygon.length === 0}
              onClick={() => setDraftPolygon([])}
              className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Clear
            </button>
          </div>
          {myLocation ? (
            <p className="text-xs text-black/70">
              My location: {coordsText(myLocation.lat, myLocation.lng)} | accuracy {Math.round(myLocation.accuracy)}m
            </p>
          ) : null}
          {locationError ? <p className="text-xs font-semibold text-signal">{locationError}</p> : null}

          <div className="space-y-2 rounded-lg border border-black/10 bg-surface p-3">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-black/55">Polygon Label</label>
            <input
              value={annotationLabel}
              onChange={(event) => setAnnotationLabel(event.target.value)}
              className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring"
              placeholder="possible_area"
            />
            <button
              type="button"
              disabled={!canDrawMap || draftPolygon.length < 3 || mapBusy}
              onClick={() => void handleSavePolygon()}
              className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {mapBusy ? "Saving..." : "Save Polygon"}
            </button>
            {!canDrawMap ? <p className="text-xs font-semibold text-signal">Only seeker can draw map annotations</p> : null}
            {mapError ? <p className="text-xs font-semibold text-signal">{mapError}</p> : null}
          </div>

          <div className="space-y-2 rounded-lg border border-black/10 bg-surface p-3">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-black/55">POI Search</label>
            <div className="flex gap-2">
              <input
                value={poiQuery}
                onChange={(event) => setPoiQuery(event.target.value)}
                className="flex-1 rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring"
                placeholder="place/category"
              />
              <button
                type="button"
                disabled={poiLoading}
                onClick={() => void handleSearchPlaces()}
                className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Search
              </button>
            </div>
            {poiError ? <p className="text-xs font-semibold text-signal">{poiError}</p> : null}
            <ul className="space-y-2 text-xs">
              {poiResults.slice(0, 8).map((place, index) => (
                <li key={String(place.placeId ?? index)} className="rounded-lg border border-black/10 bg-white px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">{String(place.name ?? "POI")}</p>
                      <p className="text-black/60">
                        {coordsText(place.lat, place.lng)} | {Math.round(Number(place.distanceMeters ?? 0))}m
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={!canDrawMap}
                      onClick={() => {
                        const center = toPlaceCenter(place);
                        if (!center) {
                          return;
                        }
                        setDraftPolygon((prev) => [...prev, center].slice(-30));
                      }}
                      className="rounded-lg border border-black/20 bg-white px-2 py-1 text-xs font-semibold disabled:opacity-50"
                    >
                      Add Vertex
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded-lg border border-black/10 bg-surface p-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-black/50">Draft Polygon</p>
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs">
                {draftPolygon.length === 0 ? (
                  <li className="text-black/55">No vertices</li>
                ) : (
                  draftPolygon.map((point, index) => (
                    <li key={`${point.lat}-${point.lng}-${index}`} className="font-mono text-black/75">
                      {index + 1}. {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div className="rounded-lg border border-black/10 bg-surface p-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-black/50">Players</p>
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs">
                {players.map((player) => (
                  <li key={player.id}>
                    {player.name ?? player.id.slice(-6)} ({player.role ?? "unknown"}) {"-> "}
                    {coordsText(player.location?.lat, player.location?.lng)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "qa" ? (
        <section className="mt-4 space-y-3 rounded-xl border border-black/10 bg-white p-4">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/50">Q&A</p>
          <div className="flex flex-wrap gap-2">
            {defs.map((def) => (
              <button
                key={def.key}
                type="button"
                onClick={() => setAskCategory(def.key)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                  askCategory === def.key
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-black/20 bg-white text-black/70"
                }`}
              >
                {def.label ?? def.key}
              </button>
            ))}
          </div>
          <input
            value={askPrompt}
            onChange={(event) => setAskPrompt(event.target.value)}
            className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring"
            placeholder="Ask prompt (optional)"
          />
          <button
            type="button"
            disabled={Boolean(askReason)}
            onClick={() => void onAsk()}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Ask Question
          </button>
          {askReason ? <p className="text-xs font-semibold text-signal">{askReason}</p> : null}

          <div className="h-px bg-black/10" />
          <p className="text-xs text-black/70">Pending Question: {pendingQuestionId || "-"}</p>
          <input
            value={answerValue}
            onChange={(event) => setAnswerValue(event.target.value)}
            className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring"
            placeholder="Answer value"
          />
          <button
            type="button"
            disabled={Boolean(answerReason)}
            onClick={() => void onAnswer()}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Submit Answer
          </button>
          {answerReason ? <p className="text-xs font-semibold text-signal">{answerReason}</p> : null}
        </section>
      ) : null}

      {activeTab === "cards" ? (
        <section className="mt-4 space-y-3 rounded-xl border border-black/10 bg-white p-4">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/50">Cards</p>
          <ul className="space-y-2">
            {hand.length === 0 ? (
              <li className="text-sm text-black/60">No cards in hand</li>
            ) : (
              hand.map((card, index) => (
                <li key={String(card.id ?? index)} className="rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm">
                  <p className="font-semibold">{String(card.name ?? card.templateId ?? "Card")}</p>
                  <p className="text-xs text-black/60">{String(card.type ?? "unknown")}</p>
                </li>
              ))
            )}
          </ul>

          <div className="h-px bg-black/10" />
          <input
            value={drawCountText}
            onChange={(event) => setDrawCountText(event.target.value)}
            className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring"
            placeholder="Draw count (1-3)"
          />
          <button
            type="button"
            disabled={Boolean(drawReason)}
            onClick={() => void onDraw()}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Draw Card
          </button>
          {drawReason ? <p className="text-xs font-semibold text-signal">{drawReason}</p> : null}

          <div className="h-px bg-black/10" />
          <div className="grid gap-2 md:grid-cols-2">
            <select
              value={selectedCurseCardId}
              onChange={(event) => setSelectedCurseCardId(event.target.value)}
              className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring"
            >
              <option value="">Select curse card</option>
              {curseCards.map((card) => (
                <option key={String(card.id ?? "")} value={String(card.id ?? "")}>
                  {String(card.name ?? card.id ?? "curse")}
                </option>
              ))}
            </select>
            <select
              value={selectedCurseTargetId}
              onChange={(event) => setSelectedCurseTargetId(event.target.value)}
              className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring"
            >
              <option value="">Select seeker target</option>
              {seekerPlayers.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name ?? player.id.slice(-6)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={Boolean(castReason)}
            onClick={() => void onCastCurse()}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Cast Curse
          </button>
          {castReason ? <p className="text-xs font-semibold text-signal">{castReason}</p> : null}
        </section>
      ) : null}

      {activeTab === "dice" ? (
        <section className="mt-4 space-y-3 rounded-xl border border-black/10 bg-white p-4">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/50">Dice</p>
          <div className="grid gap-2 md:grid-cols-3">
            <input
              value={diceSidesText}
              onChange={(event) => setDiceSidesText(event.target.value)}
              className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring"
              placeholder="Sides"
            />
            <input
              value={diceCountText}
              onChange={(event) => setDiceCountText(event.target.value)}
              className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring"
              placeholder="Count"
            />
            <input
              value={dicePurpose}
              onChange={(event) => setDicePurpose(event.target.value)}
              className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring"
              placeholder="Purpose"
            />
          </div>
          <button
            type="button"
            disabled={Boolean(diceReason)}
            onClick={() => void onRollDice()}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Roll Dice
          </button>
          {diceReason ? <p className="text-xs font-semibold text-signal">{diceReason}</p> : null}
        </section>
      ) : null}

      {activeTab === "catch" ? (
        <section className="mt-4 space-y-3 rounded-xl border border-black/10 bg-white p-4">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/50">Catch</p>
          <select
            value={catchTargetId}
            onChange={(event) => setCatchTargetId(event.target.value)}
            className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring"
          >
            <option value="">Select hider target</option>
            {hiderPlayers.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name ?? player.id.slice(-6)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={Boolean(catchReason)}
            onClick={() => void onClaimCatch()}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Claim Catch
          </button>
          {catchReason ? <p className="text-xs font-semibold text-signal">{catchReason}</p> : null}
        </section>
      ) : null}

      {activeTab === "log" ? (
        <section className="mt-4 rounded-xl border border-black/10 bg-white p-4">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/50">Event Log ({events.length})</p>
          <ul className="mt-2 max-h-[360px] space-y-2 overflow-auto pr-1">
            {[...events].reverse().map((item) => (
              <li key={item.id} className="rounded-lg border border-black/10 bg-surface px-3 py-2 text-xs">
                <p className="font-semibold text-black/90">{item.type}</p>
                <p className="font-mono text-[11px] text-black/55">{new Date(item.ts).toLocaleTimeString()}</p>
                <p className="mt-1 font-mono text-[11px] text-black/55">{shortJson(item.data)}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
