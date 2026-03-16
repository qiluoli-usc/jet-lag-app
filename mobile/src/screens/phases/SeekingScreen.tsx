import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Marker, Polygon, Polyline, type LatLng, type Region } from "react-native-maps";
import * as Location from "expo-location";
import {
  addMapAnnotation,
  chooseRewardCards,
  searchRoomPlaces,
  updatePlayerLocation,
} from "../../lib/api";
import {
  ACTION_CAPABILITY_KEY,
  getPendingQuestion,
  getPendingRewardChoice,
  getProjectionAllowedActions,
  getProjectionCapabilities,
  getProjectionHand,
  getProjectionPlayers,
} from "../../lib/projection";
import {
  getLocationTrackingMode,
  startBackgroundTracking,
  stopBackgroundTracking,
} from "../../lib/locationTracking";
import type {
  MapPlace,
  PendingRewardChoiceProjection,
  Projection,
  ProjectionMapAnnotation,
  QuestionDef,
  RoomEvent,
  RoundAction,
} from "../../types";

interface SeekingScreenProps {
  projection: Projection | null;
  events: RoomEvent[];
  roomCode: string;
  httpBaseUrl: string;
  playerId: string;
  busyAction: string | null;
  questionDefs: QuestionDef[];
  onRefreshProjection: () => Promise<void>;
  onPerformRoundAction: (action: RoundAction, payload: Record<string, unknown>) => Promise<void>;
}

type TabKey = "map" | "ask" | "answer" | "rewards" | "cards" | "tools" | "catch" | "log";

const SEEKER_TABS: Array<{ key: TabKey; label: string }> = [
  { key: "map", label: "Map" },
  { key: "ask", label: "Ask" },
  { key: "catch", label: "Catch" },
  { key: "tools", label: "Tools" },
  { key: "log", label: "Log" },
];

const HIDER_TABS: Array<{ key: TabKey; label: string }> = [
  { key: "map", label: "Map" },
  { key: "answer", label: "Answer" },
  { key: "rewards", label: "Rewards" },
  { key: "cards", label: "Cards" },
  { key: "tools", label: "Tools" },
  { key: "log", label: "Log" },
];

const OBSERVER_TABS: Array<{ key: TabKey; label: string }> = [
  { key: "map", label: "Map" },
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
  ask: "Ask unavailable right now",
  answer: "Answer unavailable right now",
  drawCard: "Draw unavailable right now",
  castCurse: "Cast unavailable right now",
  rollDice: "Roll unavailable right now",
  claimCatch: "Catch unavailable right now",
};

const DEFAULT_REGION: Region = {
  latitude: 31.2304,
  longitude: 121.4737,
  latitudeDelta: 0.07,
  longitudeDelta: 0.07,
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
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

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toLatLng(value: unknown): LatLng | null {
  const row = asRecord(value);
  const lat = toFiniteNumber(row.lat) ?? toFiniteNumber(row.latitude);
  const lng = toFiniteNumber(row.lng) ?? toFiniteNumber(row.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    latitude: Number(lat),
    longitude: Number(lng),
  };
}

function toRegion(center: LatLng, delta = 0.04): Region {
  return {
    latitude: center.latitude,
    longitude: center.longitude,
    latitudeDelta: delta,
    longitudeDelta: delta,
  };
}

function annotationFromEvent(event: RoomEvent): ProjectionMapAnnotation | null {
  if (event.type !== "map.annotation.added") {
    return null;
  }

  const data = asRecord(event.data);
  return {
    id: String(data.annotationId ?? ""),
    annotationId: String(data.annotationId ?? ""),
    playerId: String(data.playerId ?? event.actorId ?? ""),
    layer: String(data.layer ?? "possible_area"),
    geometryType: String(data.geometryType ?? "polygon"),
    geometry: asRecord(data.geometry),
    label: String(data.label ?? ""),
    sourceQuestionId: typeof data.sourceQuestionId === "string" ? data.sourceQuestionId : null,
    createdAt: String(data.createdAt ?? event.ts),
  };
}

function extractPolygonPoints(annotation: ProjectionMapAnnotation): LatLng[] {
  const row = asRecord(annotation.geometry);
  const candidates =
    (Array.isArray(row.vertices) ? row.vertices : null) ??
    (Array.isArray(row.points) ? row.points : null) ??
    (Array.isArray(row.coordinates) ? row.coordinates : null) ??
    [];

  return candidates
    .map((item) => toLatLng(item))
    .filter((item): item is LatLng => Boolean(item));
}

function getTabItems(role: string): Array<{ key: TabKey; label: string }> {
  if (role === "seeker") {
    return SEEKER_TABS;
  }
  if (role === "hider") {
    return HIDER_TABS;
  }
  return OBSERVER_TABS;
}

function getCardTitle(card: Record<string, unknown>): string {
  return String(card.name ?? card.templateId ?? card.id ?? "Card");
}

function getCardMeta(card: Record<string, unknown>): string {
  const type = String(card.type ?? "unknown");
  const effect = card.effect ? ` | ${shortJson(card.effect)}` : "";
  return `${type}${effect}`;
}

function getLatestEvent(
  events: RoomEvent[],
  type: string,
  predicate?: (event: RoomEvent) => boolean,
): RoomEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const candidate = events[index];
    if (candidate.type !== type) {
      continue;
    }
    if (predicate && !predicate(candidate)) {
      continue;
    }
    return candidate;
  }
  return null;
}

function formatClock(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "-";
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleTimeString() : value;
}

function formatCountdownMs(value: number): string {
  const totalSec = Math.max(0, Math.ceil(value / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getRoleHero(role: string) {
  if (role === "seeker") {
    return {
      eyebrow: "Seeker View",
      title: "Track, ask, and close the gap",
      desc: "Only seeker controls are shown here. Hider-only tools stay hidden.",
      accentStyle: styles.heroCardSeeker,
    };
  }
  if (role === "hider") {
    return {
      eyebrow: "Hider View",
      title: "Answer, choose rewards, and manage your hand",
      desc: "This view is trimmed to hider actions so reward flow and answers stay obvious.",
      accentStyle: styles.heroCardHider,
    };
  }
  return {
    eyebrow: "Observer View",
    title: "Read-only event feed",
    desc: "Observer mode keeps only shared state visible.",
    accentStyle: styles.heroCardObserver,
  };
}

export function SeekingScreen({
  projection,
  events,
  roomCode,
  httpBaseUrl,
  playerId,
  busyAction,
  questionDefs,
  onRefreshProjection,
  onPerformRoundAction,
}: SeekingScreenProps) {
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
  const [dicePurpose, setDicePurpose] = useState("mobile_action");
  const [catchTargetId, setCatchTargetId] = useState("");
  const [rewardSelection, setRewardSelection] = useState<string[]>([]);
  const [rewardBusy, setRewardBusy] = useState(false);
  const [uiNowMs, setUiNowMs] = useState(() => Date.now());

  const [locationPermission, setLocationPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [myLocation, setMyLocation] = useState<LatLng | null>(null);
  const [lastAccuracyM, setLastAccuracyM] = useState<number | null>(null);

  const [mapRegion, setMapRegion] = useState<Region | null>(null);
  const [poiQuery, setPoiQuery] = useState("");
  const [poiLoading, setPoiLoading] = useState(false);
  const [poiError, setPoiError] = useState<string | null>(null);
  const [poiResults, setPoiResults] = useState<MapPlace[]>([]);

  const [draftPolygon, setDraftPolygon] = useState<LatLng[]>([]);
  const [annotationLabel, setAnnotationLabel] = useState("possible_area");
  const [mapBusy, setMapBusy] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const mapRef = useRef<MapView | null>(null);
  const locationInFlightRef = useRef(false);
  const trackingMode = getLocationTrackingMode();

  const players = useMemo(() => getProjectionPlayers(projection), [projection]);
  const hand = useMemo(() => getProjectionHand(projection), [projection]);
  const capabilities = useMemo(() => getProjectionCapabilities(projection), [projection]);
  const allowedActions = useMemo(() => getProjectionAllowedActions(projection), [projection]);
  const pendingQuestion = useMemo(() => getPendingQuestion(projection), [projection]);
  const pendingRewardChoice = useMemo(() => getPendingRewardChoice(projection), [projection]);

  const me = useMemo(
    () => players.find((item) => item.id === playerId) ?? null,
    [players, playerId],
  );

  const meRole = String(me?.role ?? "").toLowerCase();
  const isSeeker = meRole === "seeker";
  const isHider = meRole === "hider";
  const canReportLocation = isSeeker || isHider;
  const canDrawMap = isSeeker && capabilities.canDrawMap !== false;
  const tabItems = useMemo(() => getTabItems(meRole), [meRole]);

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

  const latestAskedEvent = useMemo(() => getLatestEvent(events, "question.asked"), [events]);
  const latestAnsweredEvent = useMemo(() => getLatestEvent(events, "question.answered"), [events]);
  const latestRewardDrawEvent = useMemo(
    () => getLatestEvent(events, "card.drawn", (event) => asRecord(event.data).source === "question_reward"),
    [events],
  );
  const latestRewardSelectedEvent = useMemo(() => getLatestEvent(events, "question.reward.selected"), [events]);
  const latestRewardSkippedEvent = useMemo(() => getLatestEvent(events, "question.reward.skipped"), [events]);

  const latestAskedData = useMemo(() => asRecord(latestAskedEvent?.data), [latestAskedEvent]);
  const latestAnswerData = useMemo(() => asRecord(latestAnsweredEvent?.data), [latestAnsweredEvent]);
  const latestRewardDrawData = useMemo(() => asRecord(latestRewardDrawEvent?.data), [latestRewardDrawEvent]);
  const latestRewardSelectedData = useMemo(() => asRecord(latestRewardSelectedEvent?.data), [latestRewardSelectedEvent]);
  const latestRewardSkippedData = useMemo(() => asRecord(latestRewardSkippedEvent?.data), [latestRewardSkippedEvent]);
  const myActiveCurses = useMemo(() => {
    return Array.isArray(me?.activeCurses)
      ? me.activeCurses.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      : [];
  }, [me]);

  const playerMarkers = useMemo(() => {
    return players
      .map((player) => {
        const point = toLatLng(player.location);
        if (!point) {
          return null;
        }
        return {
          id: player.id,
          name: String(player.name ?? player.id.slice(-6)),
          role: String(player.role ?? "observer"),
          ready: Boolean(player.ready),
          isMe: player.id === playerId,
          coordinate: point,
        };
      })
      .filter((item): item is {
        id: string;
        name: string;
        role: string;
        ready: boolean;
        isMe: boolean;
        coordinate: LatLng;
      } => Boolean(item));
  }, [players, playerId]);

  const mapAnnotations = useMemo(() => {
    const projected = Array.isArray(projection?.mapAnnotations) ? projection.mapAnnotations : [];
    if (projected.length > 0) {
      return projected;
    }
    return events
      .map((event) => annotationFromEvent(event))
      .filter((item): item is ProjectionMapAnnotation => Boolean(item));
  }, [projection, events]);

  const annotationPolygons = useMemo(() => {
    return mapAnnotations
      .filter((item) => String(item.geometryType ?? "polygon").toLowerCase() === "polygon")
      .map((item) => ({
        id: String(item.annotationId ?? item.id ?? ""),
        layer: String(item.layer ?? "possible_area"),
        label: String(item.label ?? ""),
        points: extractPolygonPoints(item),
      }))
      .filter((item) => item.points.length >= 3);
  }, [mapAnnotations]);

  const rewardCards = useMemo(() => {
    const choice = pendingRewardChoice as PendingRewardChoiceProjection | null;
    return Array.isArray(choice?.candidateCards)
      ? choice.candidateCards.filter((card): card is Record<string, unknown> => Boolean(card && typeof card === "object"))
      : [];
  }, [pendingRewardChoice]);

  useEffect(() => {
    if (!tabItems.some((item) => item.key === activeTab)) {
      setActiveTab(tabItems[0]?.key ?? "map");
    }
  }, [activeTab, tabItems]);

  useEffect(() => {
    const timer = setInterval(() => {
      setUiNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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

  useEffect(() => {
    if (mapRegion) {
      return;
    }
    const seedPoint = myLocation ?? playerMarkers[0]?.coordinate ?? null;
    if (seedPoint) {
      setMapRegion(toRegion(seedPoint));
    }
  }, [mapRegion, myLocation, playerMarkers]);

  useEffect(() => {
    if (!pendingRewardChoice) {
      setRewardSelection([]);
      return;
    }

    const keepCount = Math.max(1, Number(pendingRewardChoice.keepCount ?? 1));
    const availableIds = rewardCards
      .map((card) => String(card.id ?? ""))
      .filter((cardId) => cardId.length > 0);

    setRewardSelection((prev) => {
      const filtered = prev.filter((cardId) => availableIds.includes(cardId));
      if (filtered.length > 0) {
        return filtered.slice(0, keepCount);
      }
      return availableIds.slice(0, keepCount);
    });
  }, [pendingRewardChoice, rewardCards]);

  const reportLocation = useCallback(async () => {
    if (!canReportLocation || locationInFlightRef.current) {
      return;
    }
    locationInFlightRef.current = true;
    setLocationBusy(true);

    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        mayShowUserSettingsDialog: false,
      });

      const lat = Number(position.coords.latitude);
      const lng = Number(position.coords.longitude);
      const accuracy = Number(position.coords.accuracy ?? 0);
      const point = { latitude: lat, longitude: lng };

      setMyLocation(point);
      setLastAccuracyM(Number.isFinite(accuracy) ? accuracy : null);
      setLocationError(null);

      await updatePlayerLocation(httpBaseUrl, roomCode, {
        playerId,
        lat,
        lng,
        accuracy,
      });

      if (activeTab === "map" && mapRef.current) {
        mapRef.current.animateToRegion(toRegion(point), 350);
      }
    } catch (caught) {
      setLocationError(caught instanceof Error ? caught.message : "Location update failed");
    } finally {
      setLocationBusy(false);
      locationInFlightRef.current = false;
    }
  }, [activeTab, canReportLocation, httpBaseUrl, playerId, roomCode]);

  useEffect(() => {
    if (!canReportLocation) {
      setLocationPermission("unknown");
      void stopBackgroundTracking();
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function initTracking() {
      const success = await startBackgroundTracking(httpBaseUrl, roomCode, playerId);
      if (!active) {
        return;
      }
      setLocationPermission(success ? "granted" : "denied");
      if (!success) {
        return;
      }
      void reportLocation();
      timer = setInterval(() => {
        void reportLocation();
      }, LOCATION_REPORT_INTERVAL_MS);
    }

    void initTracking();

    return () => {
      active = false;
      if (timer) {
        clearInterval(timer);
      }
      void stopBackgroundTracking();
    };
  }, [canReportLocation, httpBaseUrl, playerId, reportLocation, roomCode]);

  const handleSearchPlaces = useCallback(async () => {
    setPoiLoading(true);
    setPoiError(null);

    try {
      const center = mapRegion
        ? { lat: mapRegion.latitude, lng: mapRegion.longitude }
        : myLocation
          ? { lat: myLocation.latitude, lng: myLocation.longitude }
          : null;

      const response = await searchRoomPlaces(httpBaseUrl, roomCode, {
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
  }, [httpBaseUrl, mapRegion, myLocation, playerId, poiQuery, roomCode]);

  const handleMapPress = useCallback((event: { nativeEvent?: { coordinate?: { latitude?: number; longitude?: number } } }) => {
    if (!canDrawMap) {
      return;
    }
    const coordinate = event?.nativeEvent?.coordinate;
    if (!coordinate) {
      return;
    }
    const lat = toFiniteNumber(coordinate.latitude);
    const lng = toFiniteNumber(coordinate.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return;
    }
    setDraftPolygon((prev) => [...prev, { latitude: Number(lat), longitude: Number(lng) }].slice(-30));
  }, [canDrawMap]);

  const handleAppendPlaceToPolygon = useCallback((place: MapPlace) => {
    const lat = toFiniteNumber(place.lat);
    const lng = toFiniteNumber(place.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return;
    }

    const point = {
      latitude: Number(lat),
      longitude: Number(lng),
    };

    setDraftPolygon((prev) => [...prev, point].slice(-30));
    if (mapRef.current) {
      mapRef.current.animateToRegion(toRegion(point), 350);
    }
  }, []);

  const handleCenterOnMe = useCallback(() => {
    if (!myLocation || !mapRef.current) {
      return;
    }
    mapRef.current.animateToRegion(toRegion(myLocation), 350);
  }, [myLocation]);

  const handleSavePolygon = useCallback(async () => {
    if (!canDrawMap || draftPolygon.length < 3 || mapBusy) {
      return;
    }

    setMapBusy(true);
    setMapError(null);

    try {
      await addMapAnnotation(httpBaseUrl, roomCode, {
        playerId,
        layer: "possible_area",
        geometryType: "polygon",
        geometry: {
          vertices: draftPolygon.map((point) => ({
            lat: Number(point.latitude.toFixed(6)),
            lng: Number(point.longitude.toFixed(6)),
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
  }, [
    annotationLabel,
    canDrawMap,
    draftPolygon,
    httpBaseUrl,
    mapBusy,
    onRefreshProjection,
    playerId,
    roomCode,
  ]);

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

  const askCooldownReason = (() => {
    const next = typeof capabilities.nextQuestionAt === "string" ? capabilities.nextQuestionAt : null;
    if (!next) {
      return null;
    }
    const nextAtMs = Date.parse(next);
    if (!Number.isFinite(nextAtMs) || nextAtMs <= Date.now()) {
      return null;
    }
    return `Question cooldown until ${new Date(nextAtMs).toLocaleTimeString()}`;
  })();

  const askReason =
    baseActionReason("ask") ??
    (!askCategory ? "Select a question category" : null) ??
    (askBlockedCategories.includes(String(askCategory).toLowerCase())
      ? `Category blocked by curse: ${askCategory}`
      : null) ??
    askCooldownReason;

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
  const catchReason = baseActionReason("claimCatch") ?? (!catchTargetId ? "No hider target selected" : null);

  const rewardKeepCount = Math.max(1, Number(pendingRewardChoice?.keepCount ?? 1));
  const rewardReason =
    rewardBusy
      ? "Submitting..."
      : !pendingRewardChoice
        ? "No reward choice pending"
        : rewardCards.length === 0
          ? "Reward cards are still syncing"
          : rewardSelection.length !== rewardKeepCount
            ? `Select exactly ${rewardKeepCount} card${rewardKeepCount > 1 ? "s" : ""}`
            : null;

  const handleAsk = async () => {
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

  const handleAnswer = async () => {
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

  const handleDraw = async () => {
    if (drawReason) {
      return;
    }
    await onPerformRoundAction("drawCard", {
      playerId,
      count: drawCount,
    });
  };

  const handleCastCurse = async () => {
    if (castReason) {
      return;
    }
    await onPerformRoundAction("castCurse", {
      playerId,
      cardId: selectedCurseCardId,
      targetPlayerId: selectedCurseTargetId,
    });
  };

  const handleRollDice = async () => {
    if (diceReason) {
      return;
    }
    await onPerformRoundAction("rollDice", {
      playerId,
      sides: diceSides,
      count: diceCount,
      purpose: dicePurpose.trim() || "mobile_action",
    });
  };

  const handleClaimCatch = async () => {
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

  const toggleRewardSelection = useCallback((cardId: string) => {
    if (!pendingRewardChoice) {
      return;
    }

    setRewardSelection((prev) => {
      if (prev.includes(cardId)) {
        return prev.filter((item) => item !== cardId);
      }
      if (prev.length >= rewardKeepCount) {
        return [...prev.slice(1), cardId];
      }
      return [...prev, cardId];
    });
  }, [pendingRewardChoice, rewardKeepCount]);

  const handleSubmitRewardChoice = useCallback(async () => {
    if (rewardReason) {
      return;
    }

    setRewardBusy(true);
    try {
      await chooseRewardCards(httpBaseUrl, roomCode, {
        playerId,
        cardIds: rewardSelection,
      });
      await onRefreshProjection();
      setActiveTab("cards");
    } finally {
      setRewardBusy(false);
    }
  }, [httpBaseUrl, onRefreshProjection, playerId, rewardReason, rewardSelection, roomCode]);

  const hero = getRoleHero(meRole);

  return (
    <View style={styles.wrap}>
      <View style={[styles.heroCard, hero.accentStyle]}>
        <Text style={styles.heroEyebrow}>{hero.eyebrow}</Text>
        <Text style={styles.heroTitle}>{hero.title}</Text>
        <Text style={styles.heroDesc}>{hero.desc}</Text>
      </View>

      {isHider && pendingQuestionId ? (
        <Pressable style={[styles.callout, styles.calloutHider]} onPress={() => setActiveTab("answer")}>
          <Text style={styles.calloutTitle}>Pending question waiting</Text>
          <Text style={styles.calloutBody}>{String(pendingQuestion?.prompt ?? "Open Answer to respond.")}</Text>
        </Pressable>
      ) : null}

      {isHider && pendingRewardChoice ? (
        <Pressable style={[styles.callout, styles.calloutReward]} onPress={() => setActiveTab("rewards")}>
          <Text style={styles.calloutTitle}>Reward cards ready</Text>
          <Text style={styles.calloutBody}>
            Choose {rewardKeepCount} of {rewardCards.length} card(s) to actually add them into your hand.
          </Text>
        </Pressable>
      ) : null}

      {isSeeker && latestAnsweredEvent ? (
        <Pressable style={[styles.callout, styles.calloutSeeker]} onPress={() => setActiveTab("ask")}>
          <Text style={styles.calloutTitle}>Latest answer received</Text>
          <Text style={styles.calloutBody}>{String(latestAnswerData.value ?? "Open Ask to review it.")}</Text>
        </Pressable>
      ) : null}

      {myActiveCurses.length > 0 ? (
        <View style={[styles.callout, styles.calloutCurse]}>
          <Text style={styles.calloutTitle}>Active curse effects</Text>
          {myActiveCurses.map((curse, index) => {
            const effect = asRecord(curse.effect);
            const expiresAtMs = Number(curse.expiresAtMs ?? 0);
            const remainingMs = Number.isFinite(expiresAtMs) ? Math.max(0, expiresAtMs - uiNowMs) : 0;
            return (
              <Text key={String(curse.id ?? index)} style={styles.calloutBody}>
                {String(curse.sourceTemplateId ?? effect.kind ?? "curse")} | {String(effect.kind ?? "effect")} | {formatCountdownMs(remainingMs)} left
              </Text>
            );
          })}
        </View>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
        {tabItems.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              style={[styles.tabButton, active ? styles.tabButtonActive : null]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[styles.tabButtonText, active ? styles.tabButtonTextActive : null]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {activeTab === "map" ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Map + Tracking</Text>
          <View style={styles.badgeRow}>
            <Text style={styles.badge}>Role {meRole || "observer"}</Text>
            <Text style={styles.badge}>Perm {locationPermission.toUpperCase()}</Text>
            <Text style={styles.badge}>Mode {trackingMode === "background" ? "BG" : "FG"}</Text>
            {lastAccuracyM !== null ? <Text style={styles.badge}>Acc {Math.round(lastAccuracyM)}m</Text> : null}
            {canDrawMap ? <Text style={styles.badge}>Vertices {draftPolygon.length}</Text> : null}
          </View>

          <MapView
            ref={mapRef}
            style={styles.mapView}
            initialRegion={mapRegion ?? DEFAULT_REGION}
            onRegionChangeComplete={(region: Region) => setMapRegion(region)}
            onPress={handleMapPress}
          >
            {annotationPolygons.map((annotation) => (
              <Polygon
                key={annotation.id || `${annotation.layer}-${annotation.label}`}
                coordinates={annotation.points}
                strokeColor="#0a5f66"
                fillColor="rgba(10,95,102,0.16)"
                strokeWidth={2}
              />
            ))}
            {draftPolygon.length >= 2 ? <Polyline coordinates={draftPolygon} strokeColor="#1d7a4c" strokeWidth={2} /> : null}
            {draftPolygon.length >= 3 ? (
              <Polygon
                coordinates={draftPolygon}
                strokeColor="#1d7a4c"
                fillColor="rgba(29,122,76,0.14)"
                strokeWidth={2}
              />
            ) : null}
            {playerMarkers.map((marker) => (
              <Marker
                key={`player-${marker.id}`}
                coordinate={marker.coordinate}
                pinColor={marker.isMe ? "#0a5f66" : marker.role === "hider" ? "#8f3f68" : "#c76528"}
                title={`${marker.name}${marker.isMe ? " (You)" : ""}`}
                description={`${marker.role} | ${marker.ready ? "ready" : "not ready"}`}
              />
            ))}
            {poiResults.map((place, index) => {
              const lat = toFiniteNumber(place.lat);
              const lng = toFiniteNumber(place.lng);
              if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                return null;
              }
              return (
                <Marker
                  key={`poi-${String(place.placeId ?? index)}`}
                  coordinate={{ latitude: Number(lat), longitude: Number(lng) }}
                  pinColor="#4d7aaf"
                  title={String(place.name ?? "POI")}
                  description={`${Math.round(Number(place.distanceMeters ?? 0))}m`}
                />
              );
            })}
          </MapView>

          <View style={styles.row}>
            <Pressable
              style={[styles.secondaryButton, !canReportLocation ? styles.buttonDisabled : null]}
              disabled={!canReportLocation || locationBusy}
              onPress={() => void reportLocation()}
            >
              <Text style={styles.secondaryButtonText}>{locationBusy ? "Locating..." : "Report Location"}</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, !myLocation ? styles.buttonDisabled : null]}
              disabled={!myLocation}
              onPress={handleCenterOnMe}
            >
              <Text style={styles.secondaryButtonText}>Center On Me</Text>
            </Pressable>
          </View>

          {locationError ? <Text style={styles.reasonText}>{locationError}</Text> : null}
          {trackingMode === "foreground" && canReportLocation ? (
            <Text style={styles.noteText}>
              Expo Go on iPhone only supports foreground tracking. Keep the app open while testing movement.
            </Text>
          ) : null}

          {isSeeker ? (
            <>
              <View style={styles.separator} />
              <Text style={styles.panelTitle}>Draw Polygon</Text>
              <TextInput
                value={annotationLabel}
                onChangeText={setAnnotationLabel}
                placeholder="Polygon label"
                style={styles.input}
              />
              <View style={styles.row}>
                <Pressable
                  style={[styles.secondaryButton, !canDrawMap || draftPolygon.length === 0 ? styles.buttonDisabled : null]}
                  disabled={!canDrawMap || draftPolygon.length === 0}
                  onPress={() => setDraftPolygon((prev) => prev.slice(0, -1))}
                >
                  <Text style={styles.secondaryButtonText}>Undo Vertex</Text>
                </Pressable>
                <Pressable
                  style={[styles.secondaryButton, !canDrawMap || draftPolygon.length === 0 ? styles.buttonDisabled : null]}
                  disabled={!canDrawMap || draftPolygon.length === 0}
                  onPress={() => setDraftPolygon([])}
                >
                  <Text style={styles.secondaryButtonText}>Clear Draft</Text>
                </Pressable>
              </View>
              <Pressable
                style={[styles.primaryButton, !canDrawMap || draftPolygon.length < 3 || mapBusy ? styles.buttonDisabled : null]}
                disabled={!canDrawMap || draftPolygon.length < 3 || mapBusy}
                onPress={() => void handleSavePolygon()}
              >
                <Text style={styles.primaryButtonText}>{mapBusy ? "Saving..." : "Save Polygon"}</Text>
              </Pressable>
              {mapError ? <Text style={styles.reasonText}>{mapError}</Text> : null}

              <View style={styles.separator} />
              <Text style={styles.panelTitle}>POI Search</Text>
              <TextInput
                value={poiQuery}
                onChangeText={setPoiQuery}
                placeholder="Search place name/category"
                style={styles.input}
              />
              <Pressable
                style={[styles.primaryButton, poiLoading ? styles.buttonDisabled : null]}
                disabled={poiLoading}
                onPress={() => void handleSearchPlaces()}
              >
                <Text style={styles.primaryButtonText}>Search POI</Text>
              </Pressable>
              {poiLoading ? (
                <View style={styles.loadingInline}>
                  <ActivityIndicator size="small" color="#0a5f66" />
                  <Text style={styles.mutedText}>Searching places...</Text>
                </View>
              ) : null}
              {poiError ? <Text style={styles.reasonText}>{poiError}</Text> : null}

              <ScrollView style={styles.smallScroll} contentContainerStyle={styles.stack}>
                {poiResults.length === 0 ? (
                  <Text style={styles.mutedText}>No POI results yet</Text>
                ) : (
                  poiResults.map((place, index) => (
                    <View key={`poi-row-${String(place.placeId ?? index)}`} style={styles.cardRow}>
                      <View style={styles.fill}>
                        <Text style={styles.cardTitle}>{String(place.name ?? "POI")}</Text>
                        <Text style={styles.cardMeta}>{Math.round(Number(place.distanceMeters ?? 0))}m</Text>
                      </View>
                      <Pressable style={styles.secondaryButton} onPress={() => handleAppendPlaceToPolygon(place)}>
                        <Text style={styles.secondaryButtonText}>Add Vertex</Text>
                      </Pressable>
                    </View>
                  ))
                )}
              </ScrollView>
            </>
          ) : null}
        </View>
      ) : null}

      {activeTab === "ask" ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Question Control</Text>
          <View style={styles.statusCard}>
            <Text style={styles.statusEyebrow}>{pendingQuestionId ? "Waiting For Answer" : "Latest Answer"}</Text>
            <Text style={styles.statusTitle}>
              {pendingQuestionId
                ? String(pendingQuestion?.prompt ?? latestAskedData.prompt ?? "Pending question")
                : String(latestAnswerData.value ?? "No answer received yet")}
            </Text>
            <Text style={styles.statusBody}>
              {pendingQuestionId
                ? `Category ${String(pendingQuestion?.category ?? latestAskedData.category ?? "-")} | Due ${formatClock(pendingQuestion?.dueAt)}`
                : latestAnsweredEvent
                  ? `Answered ${formatClock(latestAnswerData.answeredAt)}${latestAnswerData.timedOut ? " | timed out" : ""}${latestAnswerData.blurredByCard ? " | blurred" : ""}`
                  : "Ask a new question when the pending slot is free."}
            </Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
            {defs.map((def) => {
              const selected = askCategory === def.key;
              return (
                <Pressable
                  key={def.key}
                  style={[styles.tabButton, selected ? styles.tabButtonActive : null]}
                  onPress={() => setAskCategory(def.key)}
                >
                  <Text style={[styles.tabButtonText, selected ? styles.tabButtonTextActive : null]}>
                    {def.label ?? def.key}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <TextInput
            value={askPrompt}
            onChangeText={setAskPrompt}
            placeholder="Ask prompt (optional)"
            style={styles.input}
          />
          <Pressable
            style={[styles.primaryButton, askReason ? styles.buttonDisabled : null]}
            disabled={Boolean(askReason)}
            onPress={() => void handleAsk()}
          >
            <Text style={styles.primaryButtonText}>Ask Question</Text>
          </Pressable>
          {askReason ? <Text style={styles.reasonText}>{askReason}</Text> : null}
        </View>
      ) : null}

      {activeTab === "answer" ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Incoming Question</Text>
          <View style={styles.statusCard}>
            <Text style={styles.statusEyebrow}>{pendingQuestionId ? "Answer Required" : "Latest Submission"}</Text>
            <Text style={styles.statusTitle}>
              {pendingQuestionId
                ? String(pendingQuestion?.prompt ?? "Pending question")
                : String(latestAnswerData.value ?? "No answer sent yet")}
            </Text>
            <Text style={styles.statusBody}>
              {pendingQuestionId
                ? `Category ${String(pendingQuestion?.category ?? "-")} | Due ${formatClock(pendingQuestion?.dueAt)}`
                : latestAnsweredEvent
                  ? `Sent ${formatClock(latestAnswerData.answeredAt)}${latestAnswerData.timedOut ? " | timed out" : ""}`
                  : "Your answer panel stays focused on the active question only."}
            </Text>
          </View>

          <View style={styles.row}>
            <Pressable style={styles.secondaryButton} onPress={() => setAnswerValue("yes")}>
              <Text style={styles.secondaryButtonText}>Yes</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => setAnswerValue("no")}>
              <Text style={styles.secondaryButtonText}>No</Text>
            </Pressable>
          </View>

          <TextInput
            value={answerValue}
            onChangeText={setAnswerValue}
            placeholder="Answer value"
            style={styles.input}
          />
          <Pressable
            style={[styles.primaryButton, answerReason ? styles.buttonDisabled : null]}
            disabled={Boolean(answerReason)}
            onPress={() => void handleAnswer()}
          >
            <Text style={styles.primaryButtonText}>Submit Answer</Text>
          </Pressable>
          {answerReason ? <Text style={styles.reasonText}>{answerReason}</Text> : null}
        </View>
      ) : null}

      {activeTab === "rewards" ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Reward Choice</Text>
          {pendingRewardChoice ? (
            <>
              <View style={styles.statusCard}>
                <Text style={styles.statusEyebrow}>Choose Reward Cards</Text>
                <Text style={styles.statusTitle}>Keep {rewardKeepCount} of {rewardCards.length}</Text>
                <Text style={styles.statusBody}>Cards only move into your hand after confirmation.</Text>
              </View>

              <Text style={styles.statusBody}>Selected {rewardSelection.length}/{rewardKeepCount}</Text>
              <View style={styles.stack}>
                {rewardCards.map((card) => {
                  const cardId = String(card.id ?? "");
                  const selected = rewardSelection.includes(cardId);
                  return (
                    <Pressable
                      key={cardId || getCardTitle(card)}
                      style={[styles.card, selected ? styles.cardSelected : null]}
                      onPress={() => toggleRewardSelection(cardId)}
                    >
                      <Text style={[styles.cardTitle, selected ? styles.cardTitleSelected : null]}>
                        {getCardTitle(card)}
                      </Text>
                      <Text style={styles.cardMeta}>{getCardMeta(card)}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                style={[styles.primaryButton, rewardReason ? styles.buttonDisabled : null]}
                disabled={Boolean(rewardReason)}
                onPress={() => void handleSubmitRewardChoice()}
              >
                <Text style={styles.primaryButtonText}>{rewardBusy ? "Confirming..." : "Keep Selected Cards"}</Text>
              </Pressable>
              {rewardReason ? <Text style={styles.reasonText}>{rewardReason}</Text> : null}
            </>
          ) : (
            <>
              <View style={styles.statusCard}>
                <Text style={styles.statusEyebrow}>Latest Reward Status</Text>
                <Text style={styles.statusTitle}>
                  {latestRewardSelectedEvent
                    ? `Kept ${Array.isArray(latestRewardSelectedData.keptCardIds) ? latestRewardSelectedData.keptCardIds.length : 0} card(s)`
                    : latestRewardSkippedEvent
                      ? "Reward skipped"
                      : latestRewardDrawEvent
                        ? `Drew ${Number(latestRewardDrawData.count ?? 0)} candidate card(s)`
                        : "No reward pending"}
                </Text>
                <Text style={styles.statusBody}>
                  {latestRewardSelectedEvent
                    ? "Cards should now be visible in the Cards tab."
                    : latestRewardSkippedEvent
                      ? `Reason: ${String(latestRewardSkippedData.reason ?? "unknown")}`
                      : latestRewardDrawEvent
                        ? "If no chooser is visible, refresh the room projection."
                        : "Answering eligible questions can grant draw-and-keep rewards."}
                </Text>
              </View>
              <Pressable style={styles.secondaryButton} onPress={() => void onRefreshProjection()}>
                <Text style={styles.secondaryButtonText}>Refresh Reward State</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}

      {activeTab === "cards" ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Hand ({hand.length})</Text>
          {hand.length === 0 ? (
            <Text style={styles.mutedText}>No cards in hand</Text>
          ) : (
            hand.map((card, index) => (
              <View key={String(card.id ?? `card-${index}`)} style={styles.card}>
                <Text style={styles.cardTitle}>{getCardTitle(card)}</Text>
                <Text style={styles.cardMeta}>{getCardMeta(card)}</Text>
              </View>
            ))
          )}

          <View style={styles.separator} />
          <Text style={styles.panelTitle}>Draw Card</Text>
          <TextInput
            value={drawCountText}
            onChangeText={setDrawCountText}
            placeholder="Count (1-3)"
            keyboardType="number-pad"
            style={styles.input}
          />
          <Pressable
            style={[styles.primaryButton, drawReason ? styles.buttonDisabled : null]}
            disabled={Boolean(drawReason)}
            onPress={() => void handleDraw()}
          >
            <Text style={styles.primaryButtonText}>Draw Card</Text>
          </Pressable>
          {drawReason ? <Text style={styles.reasonText}>{drawReason}</Text> : null}

          <View style={styles.separator} />
          <Text style={styles.panelTitle}>Cast Curse</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
            {curseCards.map((card) => {
              const cid = String(card.id ?? "");
              const selected = selectedCurseCardId === cid;
              return (
                <Pressable
                  key={cid}
                  style={[styles.tabButton, selected ? styles.tabButtonActive : null]}
                  onPress={() => setSelectedCurseCardId(cid)}
                >
                  <Text style={[styles.tabButtonText, selected ? styles.tabButtonTextActive : null]}>
                    {getCardTitle(card)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
            {seekerPlayers.map((target) => {
              const selected = selectedCurseTargetId === target.id;
              return (
                <Pressable
                  key={target.id}
                  style={[styles.tabButton, selected ? styles.tabButtonActive : null]}
                  onPress={() => setSelectedCurseTargetId(target.id)}
                >
                  <Text style={[styles.tabButtonText, selected ? styles.tabButtonTextActive : null]}>
                    {target.name ?? target.id.slice(-6)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            style={[styles.primaryButton, castReason ? styles.buttonDisabled : null]}
            disabled={Boolean(castReason)}
            onPress={() => void handleCastCurse()}
          >
            <Text style={styles.primaryButtonText}>Cast Curse</Text>
          </Pressable>
          {castReason ? <Text style={styles.reasonText}>{castReason}</Text> : null}
        </View>
      ) : null}

      {activeTab === "tools" ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Dice</Text>
          <TextInput
            value={diceSidesText}
            onChangeText={setDiceSidesText}
            placeholder="Sides (2-100)"
            keyboardType="number-pad"
            style={styles.input}
          />
          <TextInput
            value={diceCountText}
            onChangeText={setDiceCountText}
            placeholder="Count (1-5)"
            keyboardType="number-pad"
            style={styles.input}
          />
          <TextInput
            value={dicePurpose}
            onChangeText={setDicePurpose}
            placeholder="Purpose"
            style={styles.input}
          />
          <Pressable
            style={[styles.primaryButton, diceReason ? styles.buttonDisabled : null]}
            disabled={Boolean(diceReason)}
            onPress={() => void handleRollDice()}
          >
            <Text style={styles.primaryButtonText}>Roll Dice</Text>
          </Pressable>
          {diceReason ? <Text style={styles.reasonText}>{diceReason}</Text> : null}
        </View>
      ) : null}

      {activeTab === "catch" ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Claim Catch</Text>
          <View style={styles.statusCard}>
            <Text style={styles.statusEyebrow}>Catch Flow</Text>
            <Text style={styles.statusTitle}>Target the active hider</Text>
            <Text style={styles.statusBody}>
              This tab is seeker-only so hider clients do not see catch controls at all.
            </Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
            {hiderPlayers.map((target) => {
              const selected = catchTargetId === target.id;
              return (
                <Pressable
                  key={target.id}
                  style={[styles.tabButton, selected ? styles.tabButtonActive : null]}
                  onPress={() => setCatchTargetId(target.id)}
                >
                  <Text style={[styles.tabButtonText, selected ? styles.tabButtonTextActive : null]}>
                    {target.name ?? target.id.slice(-6)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            style={[styles.primaryButton, catchReason ? styles.buttonDisabled : null]}
            disabled={Boolean(catchReason)}
            onPress={() => void handleClaimCatch()}
          >
            <Text style={styles.primaryButtonText}>Claim Catch</Text>
          </Pressable>
          {catchReason ? <Text style={styles.reasonText}>{catchReason}</Text> : null}
        </View>
      ) : null}

      {activeTab === "log" ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Event Log ({events.length})</Text>
          <ScrollView style={styles.smallScroll} contentContainerStyle={styles.stack}>
            {[...events].reverse().map((item) => (
              <View key={item.id} style={styles.card}>
                <Text style={styles.cardTitle}>{item.type}</Text>
                <Text style={styles.cardMeta}>{new Date(item.ts).toLocaleTimeString()}</Text>
                <Text style={styles.logData}>{shortJson(item.data)}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d8d6ce",
    padding: 14,
    gap: 10,
  },
  heroCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  heroCardSeeker: {
    backgroundColor: "#dff2ef",
    borderColor: "#87bcb5",
  },
  heroCardHider: {
    backgroundColor: "#f8e7ee",
    borderColor: "#c692ab",
  },
  heroCardObserver: {
    backgroundColor: "#ece9df",
    borderColor: "#cfc8b5",
  },
  heroEyebrow: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    color: "#4f4f4f",
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#1f1f1f",
  },
  heroDesc: {
    fontSize: 13,
    color: "#5e5e5e",
    lineHeight: 18,
  },
  callout: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  calloutHider: {
    backgroundColor: "#fff1f5",
    borderColor: "#d5a0b7",
  },
  calloutReward: {
    backgroundColor: "#f7f0dc",
    borderColor: "#d2b86d",
  },
  calloutSeeker: {
    backgroundColor: "#e0eff5",
    borderColor: "#8caec0",
  },
  calloutCurse: {
    backgroundColor: "#fff3df",
    borderColor: "#d59f3d",
  },
  calloutTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#313131",
    textTransform: "uppercase",
  },
  calloutBody: {
    fontSize: 13,
    color: "#4f4f4f",
  },
  tabsRow: {
    gap: 8,
    paddingBottom: 4,
  },
  tabButton: {
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#cfcdbf",
    backgroundColor: "#f2f1ea",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tabButtonActive: {
    borderColor: "#0a5f66",
    backgroundColor: "#d7eef0",
  },
  tabButtonText: {
    color: "#5a5a5a",
    fontSize: 12,
    fontWeight: "700",
  },
  tabButtonTextActive: {
    color: "#0a5f66",
  },
  panel: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d8d6ce",
    backgroundColor: "#f9f9f5",
    padding: 10,
    gap: 8,
  },
  panelTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#4f4f4f",
    textTransform: "uppercase",
  },
  statusCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d4d0c3",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  statusEyebrow: {
    fontSize: 11,
    color: "#6d675c",
    fontWeight: "800",
    textTransform: "uppercase",
  },
  statusTitle: {
    fontSize: 15,
    color: "#222222",
    fontWeight: "800",
  },
  statusBody: {
    fontSize: 12,
    color: "#5e5e5e",
    lineHeight: 17,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
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
  mapView: {
    width: "100%",
    height: 280,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d8d6ce",
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  fill: {
    flex: 1,
  },
  input: {
    borderWidth: 1,
    borderColor: "#c8c7c0",
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: "#ffffff",
    fontSize: 14,
  },
  primaryButton: {
    borderRadius: 9,
    backgroundColor: "#0a5f66",
    paddingVertical: 11,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  secondaryButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#b8b6aa",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryButtonText: {
    color: "#444444",
    fontSize: 12,
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#d8d6ce",
    marginVertical: 2,
  },
  reasonText: {
    fontSize: 12,
    color: "#8a2f39",
    fontWeight: "600",
  },
  noteText: {
    fontSize: 12,
    color: "#6a5f30",
    fontWeight: "600",
  },
  mutedText: {
    fontSize: 12,
    color: "#666666",
  },
  loadingInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  smallScroll: {
    maxHeight: 220,
  },
  stack: {
    gap: 8,
    paddingBottom: 6,
  },
  card: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d6d4cc",
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  cardRow: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d6d4cc",
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  cardSelected: {
    borderColor: "#0a5f66",
    backgroundColor: "#dff2ef",
  },
  cardTitle: {
    fontSize: 12,
    color: "#222222",
    fontWeight: "700",
  },
  cardTitleSelected: {
    color: "#0a5f66",
  },
  cardMeta: {
    fontSize: 11,
    color: "#676767",
  },
  logData: {
    fontSize: 11,
    color: "#4f4f4f",
  },
});
