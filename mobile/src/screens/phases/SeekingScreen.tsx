import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Circle, Marker, Polygon, Polyline, type LatLng, type Region } from "react-native-maps";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import {
  addMapAnnotation,
  castPlayerCard,
  chooseRewardCards,
  completeEvidenceUpload,
  createDispute,
  fetchRoomPlaceDetails,
  initEvidenceUpload,
  reverseRoomAdminLevels,
  resolveCatch,
  searchRoomPlaces,
  sendChatMessage,
  sendClue,
  updatePlayerLocation,
  uploadEvidenceBinary,
  voteDispute,
} from "../../lib/api";
import {
  ACTION_CAPABILITY_KEY,
  getPendingQuestion,
  getPendingRewardChoice,
  getProjectionAllowedActions,
  getProjectionCapabilities,
  getProjectionDisputes,
  getProjectionEvidence,
  getProjectionHand,
  getProjectionMessages,
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

type TabKey = "map" | "ask" | "answer" | "rewards" | "cards" | "tools" | "comms" | "catch" | "log";
type DrawTool = "polygon" | "line" | "circle" | "measure";
type DisputeDraftType = "place_legitimacy" | "evidence_review" | "generic";

const SEEKER_TABS: Array<{ key: TabKey; label: string }> = [
  { key: "map", label: "Map" },
  { key: "ask", label: "Ask" },
  { key: "catch", label: "Catch" },
  { key: "tools", label: "Tools" },
  { key: "comms", label: "Comms" },
  { key: "log", label: "Log" },
];

const HIDER_TABS: Array<{ key: TabKey; label: string }> = [
  { key: "map", label: "Map" },
  { key: "answer", label: "Answer" },
  { key: "rewards", label: "Rewards" },
  { key: "cards", label: "Cards" },
  { key: "tools", label: "Tools" },
  { key: "comms", label: "Comms" },
  { key: "log", label: "Log" },
];

const OBSERVER_TABS: Array<{ key: TabKey; label: string }> = [
  { key: "map", label: "Map" },
  { key: "comms", label: "Comms" },
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
const DRAW_TOOL_OPTIONS: Array<{ key: DrawTool; label: string }> = [
  { key: "polygon", label: "Polygon" },
  { key: "line", label: "Line" },
  { key: "circle", label: "Circle" },
  { key: "measure", label: "Measure" },
];
const MAP_LAYER_OPTIONS = [
  "possible_area",
  "route_guess",
  "scan_zone",
  "measurement",
];

interface EvidenceAssetDraft {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  width?: number;
  height?: number;
}

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

function distanceBetweenPoints(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  return 2 * earthRadius * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function sameLatLng(a: LatLng | null, b: LatLng | null): boolean {
  if (!a || !b) {
    return false;
  }
  return Math.abs(a.latitude - b.latitude) < 1e-6 &&
    Math.abs(a.longitude - b.longitude) < 1e-6;
}

function stripClosingLatLng(points: LatLng[]): LatLng[] {
  if (points.length >= 2 && sameLatLng(points[0], points[points.length - 1])) {
    return points.slice(0, -1);
  }
  return points;
}

function appendDraftLatLng(points: LatLng[], nextPoint: LatLng, drawTool: DrawTool): LatLng[] {
  if (drawTool === "circle") {
    return [nextPoint];
  }

  const openPoints = stripClosingLatLng(points);
  if (
    drawTool === "polygon" &&
    openPoints.length >= 2 &&
    distanceBetweenPoints(openPoints[0], nextPoint) <= 120
  ) {
    return [...openPoints, openPoints[0]];
  }

  return [...openPoints, nextPoint].slice(-30);
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

function extractConfigPolygonPoints(value: unknown): LatLng[] {
  const source = asRecord(value);
  const geometry = String(source.type ?? "").toLowerCase() === "feature"
    ? asRecord(source.geometry)
    : source;
  const coordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  const ring = Array.isArray(coordinates[0]) ? coordinates[0] : [];
  const points = ring
    .map((item) => {
      if (!Array.isArray(item) || item.length < 2) {
        return null;
      }
      const lng = toFiniteNumber(item[0]);
      const lat = toFiniteNumber(item[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }
      return {
        latitude: Number(lat),
        longitude: Number(lng),
      };
    })
    .filter((item): item is LatLng => Boolean(item));

  if (points.length >= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first.latitude === last.latitude && first.longitude === last.longitude) {
      return points.slice(0, -1);
    }
  }
  return points;
}

function extractLinePoints(annotation: ProjectionMapAnnotation): LatLng[] {
  return extractPolygonPoints(annotation);
}

function extractCircleGeometry(annotation: ProjectionMapAnnotation): { center: LatLng; radiusM: number } | null {
  const row = asRecord(annotation.geometry);
  const center = toLatLng(row.center);
  const radiusM = toFiniteNumber(row.radiusM) ?? toFiniteNumber(row.radiusMeters);
  if (!center || !Number.isFinite(radiusM) || Number(radiusM) <= 0) {
    return null;
  }
  return {
    center,
    radiusM: Number(radiusM),
  };
}

function getLayerColor(layer: string): { stroke: string; fill: string } {
  const normalized = String(layer ?? "").trim().toLowerCase();
  if (normalized === "route_guess") {
    return { stroke: "#8c5f2f", fill: "rgba(140,95,47,0.14)" };
  }
  if (normalized === "scan_zone") {
    return { stroke: "#6a4db0", fill: "rgba(106,77,176,0.12)" };
  }
  if (normalized === "measurement") {
    return { stroke: "#1d7a4c", fill: "rgba(29,122,76,0.10)" };
  }
  return { stroke: "#0a5f66", fill: "rgba(10,95,102,0.16)" };
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

function getCardId(card: Record<string, unknown>): string {
  return String(card.id ?? "").trim();
}

function getCardEffectKind(card: Record<string, unknown>): string {
  return String(asRecord(card.effect).kind ?? "").trim().toLowerCase();
}

function getCardMeta(card: Record<string, unknown>): string {
  const type = String(card.type ?? "unknown");
  const effect = card.effect ? ` | ${shortJson(card.effect)}` : "";
  return `${type}${effect}`;
}

function describePowerup(card: Record<string, unknown>): string {
  const effect = asRecord(card.effect);
  const kind = getCardEffectKind(card);
  if (kind === "veto_pending_question") {
    return "Cancels the current pending question.";
  }
  if (kind === "randomize_pending_question") {
    return "Rerolls the pending question option.";
  }
  if (kind === "discard_draw") {
    return `Discard ${Number(effect.discardCount ?? 0)} and draw ${Number(effect.drawCount ?? 1)}.`;
  }
  if (kind === "expand_hand_limit") {
    return `Increase max hand size by ${Number(effect.increment ?? 1)}.`;
  }
  return shortJson(effect);
}

function formatFileSize(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "-";
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${Math.round(bytes)} B`;
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

function formatDistanceLabel(value: number | null): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if ((value ?? 0) >= 1000) {
    return `${((value ?? 0) / 1000).toFixed(2)} km`;
  }
  return `${Math.round(value ?? 0)} m`;
}

function formatAdminLevels(value: unknown): string {
  const admin = asRecord(value);
  const ordered = ["level1", "level2", "level3", "level4"]
    .map((key) => String(admin[key] ?? "").trim())
    .filter(Boolean);
  return ordered.length > 0 ? ordered.join(" / ") : "-";
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
  const [selectedPowerupCardId, setSelectedPowerupCardId] = useState("");
  const [selectedDiscardCardIds, setSelectedDiscardCardIds] = useState<string[]>([]);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [diceSidesText, setDiceSidesText] = useState("6");
  const [diceCountText, setDiceCountText] = useState("1");
  const [dicePurpose, setDicePurpose] = useState("mobile_action");
  const [catchTargetId, setCatchTargetId] = useState("");
  const [rewardSelection, setRewardSelection] = useState<string[]>([]);
  const [rewardBusy, setRewardBusy] = useState(false);
  const [uiNowMs, setUiNowMs] = useState(() => Date.now());
  const [seekElapsedSyncedAtMs, setSeekElapsedSyncedAtMs] = useState(() => Date.now());
  const [chatInput, setChatInput] = useState("");
  const [composerMode, setComposerMode] = useState<"chat" | "clue">("chat");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

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
  const [selectedPlace, setSelectedPlace] = useState<MapPlace | null>(null);
  const [selectedPlaceDetails, setSelectedPlaceDetails] = useState<Record<string, unknown> | null>(null);
  const [selectedPlaceLegitimacy, setSelectedPlaceLegitimacy] = useState<Record<string, unknown> | null>(null);
  const [selectedPlaceAdminLevels, setSelectedPlaceAdminLevels] = useState<Record<string, unknown> | null>(null);
  const [selectedPlaceLoading, setSelectedPlaceLoading] = useState(false);
  const [selectedPlaceError, setSelectedPlaceError] = useState<string | null>(null);

  const [draftPolygon, setDraftPolygon] = useState<LatLng[]>([]);
  const [drawTool, setDrawTool] = useState<DrawTool>("polygon");
  const [annotationLayer, setAnnotationLayer] = useState("possible_area");
  const [annotationLabel, setAnnotationLabel] = useState("possible_area");
  const [circleRadiusText, setCircleRadiusText] = useState("250");
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({});
  const [showBoundaryLayer, setShowBoundaryLayer] = useState(true);
  const [showHidingAreaLayer, setShowHidingAreaLayer] = useState(true);
  const [showPlayerMarkers, setShowPlayerMarkers] = useState(true);
  const [showPoiMarkers, setShowPoiMarkers] = useState(false);
  const [showSelectedPoiMarker, setShowSelectedPoiMarker] = useState(true);
  const [mapBusy, setMapBusy] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [evidenceType, setEvidenceType] = useState("photo");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [selectedEvidenceAsset, setSelectedEvidenceAsset] = useState<EvidenceAssetDraft | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceProgress, setEvidenceProgress] = useState(0);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [disputeType, setDisputeType] = useState<DisputeDraftType>("place_legitimacy");
  const [selectedDisputeEvidenceId, setSelectedDisputeEvidenceId] = useState("");
  const [disputeDescription, setDisputeDescription] = useState("");
  const [disputeBusy, setDisputeBusy] = useState(false);
  const [disputeError, setDisputeError] = useState<string | null>(null);
  const [voteBusyDisputeId, setVoteBusyDisputeId] = useState<string | null>(null);

  const mapRef = useRef<MapView | null>(null);
  const locationInFlightRef = useRef(false);
  const trackingMode = getLocationTrackingMode();

  const players = useMemo(() => getProjectionPlayers(projection), [projection]);
  const hand = useMemo(() => getProjectionHand(projection), [projection]);
  const evidenceItems = useMemo(() => getProjectionEvidence(projection), [projection]);
  const disputeItems = useMemo(() => getProjectionDisputes(projection), [projection]);
  const messageItems = useMemo(() => getProjectionMessages(projection), [projection]);
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

  const hiderPlayers = useMemo(
    () => players.filter((item) => item.role === "hider"),
    [players],
  );
  const playerNameLookup = useMemo(() => {
    return players.reduce<Record<string, string>>((acc, player) => {
      acc[player.id] = String(player.name ?? player.id.slice(-6));
      return acc;
    }, {});
  }, [players]);
  const curseCards = useMemo(
    () => hand.filter((card) => String(card.type ?? "") === "curse"),
    [hand],
  );
  const powerupCards = useMemo(
    () => hand.filter((card) => String(card.type ?? "") === "powerup"),
    [hand],
  );
  const timeBonusCards = useMemo(
    () => hand.filter((card) => String(card.type ?? "") === "time_bonus_fixed"),
    [hand],
  );
  const selectedPowerupCard = useMemo(
    () => powerupCards.find((card) => getCardId(card) === selectedPowerupCardId) ?? null,
    [powerupCards, selectedPowerupCardId],
  );
  const selectedPowerupKind = useMemo(
    () => (selectedPowerupCard ? getCardEffectKind(selectedPowerupCard) : ""),
    [selectedPowerupCard],
  );
  const selectedPowerupDiscardCount = Math.max(0, Number(asRecord(selectedPowerupCard?.effect).discardCount ?? 0));
  const discardableCards = useMemo(
    () => hand.filter((card) => getCardId(card) !== selectedPowerupCardId),
    [hand, selectedPowerupCardId],
  );
  const sortedEvidenceItems = useMemo(() => {
    return [...evidenceItems].sort((a, b) => {
      const aTime = Date.parse(String(a.completedAt ?? a.createdAt ?? ""));
      const bTime = Date.parse(String(b.completedAt ?? b.createdAt ?? ""));
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
  }, [evidenceItems]);
  const sortedDisputes = useMemo(() => {
    return [...disputeItems].sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === "open" ? -1 : 1;
      }
      const aTime = Date.parse(String(a.createdAt ?? ""));
      const bTime = Date.parse(String(b.createdAt ?? ""));
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
  }, [disputeItems]);
  const sortedMessages = useMemo(() => {
    return [...messageItems].sort((a, b) => {
      const aTime = Date.parse(String(a.createdAt ?? ""));
      const bTime = Date.parse(String(b.createdAt ?? ""));
      return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
    });
  }, [messageItems]);

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
        colors: getLayerColor(String(item.layer ?? "possible_area")),
        points: extractPolygonPoints(item),
      }))
      .filter((item) => item.points.length >= 3);
  }, [mapAnnotations]);
  const annotationLines = useMemo(() => {
    return mapAnnotations
      .filter((item) => String(item.geometryType ?? "").toLowerCase() === "line")
      .map((item) => ({
        id: String(item.annotationId ?? item.id ?? ""),
        layer: String(item.layer ?? "route_guess"),
        label: String(item.label ?? ""),
        colors: getLayerColor(String(item.layer ?? "route_guess")),
        points: extractLinePoints(item),
      }))
      .filter((item) => item.points.length >= 2);
  }, [mapAnnotations]);
  const annotationCircles = useMemo(() => {
    return mapAnnotations
      .filter((item) => String(item.geometryType ?? "").toLowerCase() === "circle")
      .map((item) => ({
        id: String(item.annotationId ?? item.id ?? ""),
        layer: String(item.layer ?? "scan_zone"),
        label: String(item.label ?? ""),
        colors: getLayerColor(String(item.layer ?? "scan_zone")),
        circle: extractCircleGeometry(item),
      }))
      .filter((item): item is {
        id: string;
        layer: string;
        label: string;
        colors: { stroke: string; fill: string };
        circle: { center: LatLng; radiusM: number };
      } => Boolean(item.circle));
  }, [mapAnnotations]);
  const annotationLayerItems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of mapAnnotations) {
      const layer = String(item.layer ?? "possible_area");
      counts.set(layer, Number(counts.get(layer) ?? 0) + 1);
    }
    return [...counts.entries()].map(([layer, count]) => ({ layer, count }));
  }, [mapAnnotations]);
  const configBoundaryPoints = useMemo(
    () => extractConfigPolygonPoints(projection?.config?.borderPolygonGeoJSON),
    [projection?.config],
  );
  const configHidingAreaPoints = useMemo(
    () => extractConfigPolygonPoints(projection?.config?.hidingAreaGeoJSON),
    [projection?.config],
  );

  const rewardCards = useMemo(() => {
    const choice = pendingRewardChoice as PendingRewardChoiceProjection | null;
    return Array.isArray(choice?.candidateCards)
      ? choice.candidateCards.filter((card): card is Record<string, unknown> => Boolean(card && typeof card === "object"))
      : [];
  }, [pendingRewardChoice]);
  const pendingCatchClaim = useMemo(() => asRecord(projection?.round?.pendingCatchClaim), [projection?.round?.pendingCatchClaim]);
  const pendingCatchClaimId = typeof pendingCatchClaim.id === "string" ? pendingCatchClaim.id : "";
  const seekElapsedSeconds = Number(projection?.round?.seekDurationSecCurrent ?? 0);
  const liveSeekElapsedSeconds = useMemo(() => {
    const phase = String(projection?.phase ?? "").toUpperCase();
    if (!(phase === "SEEK" || phase === "SEEKING" || phase === "CAUGHT" || phase === "ENDGAME" || phase === "END_GAME")) {
      return Math.max(0, seekElapsedSeconds);
    }
    const driftSeconds = Math.max(0, Math.floor((uiNowMs - seekElapsedSyncedAtMs) / 1000));
    return Math.max(0, seekElapsedSeconds + driftSeconds);
  }, [projection?.phase, seekElapsedSeconds, seekElapsedSyncedAtMs, uiNowMs]);
  const selectedPlaceCoordinate = useMemo(() => toLatLng(selectedPlace), [selectedPlace]);
  const mapCenterCoordinate = useMemo(() => (
    mapRegion
      ? { latitude: mapRegion.latitude, longitude: mapRegion.longitude }
      : null
  ), [mapRegion]);
  const distanceFromMeToSelectedPlace = useMemo(() => (
    myLocation && selectedPlaceCoordinate
      ? distanceBetweenPoints(myLocation, selectedPlaceCoordinate)
      : null
  ), [myLocation, selectedPlaceCoordinate]);
  const distanceFromMapCenterToSelectedPlace = useMemo(() => (
    mapCenterCoordinate && selectedPlaceCoordinate
      ? distanceBetweenPoints(mapCenterCoordinate, selectedPlaceCoordinate)
      : null
  ), [mapCenterCoordinate, selectedPlaceCoordinate]);
  const selectedPlaceDetailsData = useMemo(() => asRecord(selectedPlaceDetails), [selectedPlaceDetails]);
  const selectedPlaceLegitimacyData = useMemo(() => asRecord(selectedPlaceLegitimacy), [selectedPlaceLegitimacy]);
  const circleRadiusM = useMemo(() => {
    const parsed = Number(circleRadiusText);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [circleRadiusText]);
  const draftEffectivePolygon = useMemo(() => stripClosingLatLng(draftPolygon), [draftPolygon]);
  const draftDistanceMeters = useMemo(() => {
    if (draftEffectivePolygon.length < 2) {
      return 0;
    }
    let total = 0;
    for (let index = 1; index < draftEffectivePolygon.length; index += 1) {
      total += distanceBetweenPoints(draftEffectivePolygon[index - 1], draftEffectivePolygon[index]);
    }
    return total;
  }, [draftEffectivePolygon]);
  const visibleLayerLookup = useMemo(() => {
    const lookup: Record<string, boolean> = {};
    for (const item of annotationLayerItems) {
      lookup[item.layer] = layerVisibility[item.layer] !== false;
    }
    return lookup;
  }, [annotationLayerItems, layerVisibility]);
  const visibleAnnotationPolygons = useMemo(
    () => annotationPolygons.filter((item) => visibleLayerLookup[item.layer] !== false),
    [annotationPolygons, visibleLayerLookup],
  );
  const visibleAnnotationLines = useMemo(
    () => annotationLines.filter((item) => visibleLayerLookup[item.layer] !== false),
    [annotationLines, visibleLayerLookup],
  );
  const visibleAnnotationCircles = useMemo(
    () => annotationCircles.filter((item) => visibleLayerLookup[item.layer] !== false),
    [annotationCircles, visibleLayerLookup],
  );
  const circleOnlyMode = capabilities.mapToolMode === "circle_only";

  useEffect(() => {
    if (!tabItems.some((item) => item.key === activeTab)) {
      setActiveTab(tabItems[0]?.key ?? "map");
    }
  }, [activeTab, tabItems]);

  useEffect(() => {
    if (!isHider && composerMode !== "chat") {
      setComposerMode("chat");
    }
  }, [composerMode, isHider]);

  useEffect(() => {
    setLayerVisibility((prev) => {
      const next = { ...prev };
      for (const item of annotationLayerItems) {
        if (!Object.prototype.hasOwnProperty.call(next, item.layer)) {
          next[item.layer] = true;
        }
      }
      return next;
    });
  }, [annotationLayerItems]);

  useEffect(() => {
    if (circleOnlyMode && drawTool !== "circle") {
      setDrawTool("circle");
    }
  }, [circleOnlyMode, drawTool]);

  useEffect(() => {
    setDraftPolygon([]);
    setMapError(null);
    if (drawTool === "measure") {
      setAnnotationLayer("measurement");
    } else if (drawTool === "circle" && annotationLayer === "measurement") {
      setAnnotationLayer("scan_zone");
    } else if (drawTool === "line" && annotationLayer === "measurement") {
      setAnnotationLayer("route_guess");
    } else if (drawTool === "polygon" && annotationLayer === "measurement") {
      setAnnotationLayer("possible_area");
    }
  }, [drawTool]);

  useEffect(() => {
    const timer = setInterval(() => {
      setUiNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setSeekElapsedSyncedAtMs(Date.now());
  }, [projection?.phase, projection?.round?.seekDurationSecCurrent]);

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
    if (!selectedPowerupCardId) {
      const first = powerupCards[0];
      if (first?.id) {
        setSelectedPowerupCardId(String(first.id));
      }
      return;
    }
    const exists = powerupCards.some((card) => getCardId(card) === selectedPowerupCardId);
    if (!exists) {
      setSelectedPowerupCardId("");
    }
  }, [powerupCards, selectedPowerupCardId]);

  useEffect(() => {
    const allowed = new Set(discardableCards.map((card) => getCardId(card)));
    setSelectedDiscardCardIds((prev) => prev.filter((cardId) => allowed.has(cardId)).slice(0, selectedPowerupDiscardCount));
  }, [discardableCards, selectedPowerupDiscardCount]);

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
    if (!selectedDisputeEvidenceId) {
      const first = sortedEvidenceItems[0];
      if (first?.evidenceId) {
        setSelectedDisputeEvidenceId(String(first.evidenceId));
      }
      return;
    }
    const exists = sortedEvidenceItems.some((item) => String(item.evidenceId ?? "") === selectedDisputeEvidenceId);
    if (!exists) {
      setSelectedDisputeEvidenceId("");
    }
  }, [selectedDisputeEvidenceId, sortedEvidenceItems]);

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
    } catch (caught) {
      setLocationError(caught instanceof Error ? caught.message : "Location update failed");
    } finally {
      setLocationBusy(false);
      locationInFlightRef.current = false;
    }
  }, [canReportLocation, httpBaseUrl, playerId, roomCode]);

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
      setShowPoiMarkers(true);
    } catch (caught) {
      setPoiError(caught instanceof Error ? caught.message : "POI search failed");
    } finally {
      setPoiLoading(false);
    }
  }, [httpBaseUrl, mapRegion, myLocation, playerId, poiQuery, roomCode]);

  const handleInspectPlace = useCallback(async (place: MapPlace) => {
    const placeId = String(place.placeId ?? "").trim();
    if (!placeId) {
      setSelectedPlace(place);
      setSelectedPlaceDetails(null);
      setSelectedPlaceLegitimacy(null);
      setSelectedPlaceAdminLevels(null);
      setSelectedPlaceError("Selected place does not expose a placeId");
      return;
    }

    setSelectedPlace(place);
    setSelectedPlaceLoading(true);
    setSelectedPlaceError(null);

    try {
      const coordinate = toLatLng(place);
      const [detailsResult, adminResult] = await Promise.allSettled([
        fetchRoomPlaceDetails(httpBaseUrl, roomCode, {
          playerId,
          placeId,
        }),
        coordinate
          ? reverseRoomAdminLevels(httpBaseUrl, roomCode, {
            playerId,
            lat: coordinate.latitude,
            lng: coordinate.longitude,
          })
          : Promise.resolve(null),
      ]);

      if (detailsResult.status !== "fulfilled") {
        throw detailsResult.reason;
      }

      setSelectedPlaceDetails(asRecord(detailsResult.value.place?.details));
      setSelectedPlaceLegitimacy(asRecord(detailsResult.value.place?.legitimacy));

      if (adminResult.status === "fulfilled" && adminResult.value) {
        setSelectedPlaceAdminLevels(asRecord(adminResult.value.admin?.adminLevels));
      } else {
        setSelectedPlaceAdminLevels(null);
      }
    } catch (caught) {
      setSelectedPlaceDetails(null);
      setSelectedPlaceLegitimacy(null);
      setSelectedPlaceAdminLevels(null);
      setSelectedPlaceError(caught instanceof Error ? caught.message : "Place inspection failed");
    } finally {
      setSelectedPlaceLoading(false);
    }
  }, [httpBaseUrl, playerId, roomCode]);

  const handleMapPress = useCallback((event: { nativeEvent?: { coordinate?: { latitude?: number; longitude?: number } } }) => {
    if (!canDrawMap) {
      return;
    }
    if (circleOnlyMode && drawTool !== "circle") {
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
    const point = { latitude: Number(lat), longitude: Number(lng) };
    setDraftPolygon((prev) => appendDraftLatLng(prev, point, drawTool));
  }, [canDrawMap, circleOnlyMode, drawTool]);

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

    setDraftPolygon((prev) => appendDraftLatLng(prev, point, drawTool));
    if (mapRef.current) {
      mapRef.current.animateToRegion(toRegion(point), 350);
    }
  }, [drawTool]);

  const handleAppendMyLocation = useCallback(() => {
    if (!myLocation) {
      return;
    }
    setDraftPolygon((prev) => appendDraftLatLng(prev, myLocation, drawTool));
  }, [drawTool, myLocation]);

  const handleCenterOnMe = useCallback(() => {
    if (!myLocation || !mapRef.current) {
      return;
    }
    mapRef.current.animateToRegion(toRegion(myLocation), 350);
  }, [myLocation]);

  const handleCenterOnSelectedPlace = useCallback(() => {
    if (!selectedPlaceCoordinate || !mapRef.current) {
      return;
    }
    mapRef.current.animateToRegion(toRegion(selectedPlaceCoordinate), 350);
  }, [selectedPlaceCoordinate]);

  const handleSaveDraftAnnotation = useCallback(async () => {
    if (!canDrawMap || mapBusy) {
      return;
    }
    if (circleOnlyMode && drawTool !== "circle") {
      return;
    }
    const effectiveDraftPolygon = stripClosingLatLng(draftPolygon);

    const label = annotationLabel.trim();
    const layer = annotationLayer.trim() || (
      drawTool === "measure"
        ? "measurement"
        : drawTool === "line"
          ? "route_guess"
          : drawTool === "circle"
            ? "scan_zone"
            : "possible_area"
    );

    let geometryType: "polygon" | "line" | "circle" = "polygon";
    let geometry: Record<string, unknown> | null = null;
    let fallbackLabel = layer;

    if (drawTool === "circle") {
      if (effectiveDraftPolygon.length < 1 || circleRadiusM <= 0) {
        return;
      }
      geometryType = "circle";
      geometry = {
        center: {
          lat: Number(effectiveDraftPolygon[0].latitude.toFixed(6)),
          lng: Number(effectiveDraftPolygon[0].longitude.toFixed(6)),
        },
        radiusM: Number(circleRadiusM.toFixed(1)),
      };
      fallbackLabel = `circle_${Math.round(circleRadiusM)}m`;
    } else if (drawTool === "line" || drawTool === "measure") {
      if (effectiveDraftPolygon.length < 2) {
        return;
      }
      geometryType = "line";
      geometry = {
        points: effectiveDraftPolygon.map((point) => ({
          lat: Number(point.latitude.toFixed(6)),
          lng: Number(point.longitude.toFixed(6)),
        })),
      };
      fallbackLabel = drawTool === "measure"
        ? `measure_${Math.round(draftDistanceMeters)}m`
        : layer;
    } else {
      if (effectiveDraftPolygon.length < 3) {
        return;
      }
      geometryType = "polygon";
      geometry = {
        vertices: effectiveDraftPolygon.map((point) => ({
          lat: Number(point.latitude.toFixed(6)),
          lng: Number(point.longitude.toFixed(6)),
        })),
      };
      fallbackLabel = layer;
    }

    setMapBusy(true);
    setMapError(null);

    try {
      await addMapAnnotation(httpBaseUrl, roomCode, {
        playerId,
        layer,
        geometryType,
        geometry: geometry ?? {},
        label: label || fallbackLabel,
      });
      setDraftPolygon([]);
      await onRefreshProjection();
    } catch (caught) {
      setMapError(caught instanceof Error ? caught.message : "Failed to save annotation");
    } finally {
      setMapBusy(false);
    }
  }, [
    annotationLabel,
    annotationLayer,
    canDrawMap,
    circleOnlyMode,
    circleRadiusM,
    draftPolygon,
    draftDistanceMeters,
    drawTool,
    httpBaseUrl,
    mapBusy,
    onRefreshProjection,
    playerId,
    roomCode,
  ]);

  const drawSaveReason =
    !canDrawMap
      ? "Map drawing unavailable right now"
      : busyAction
        ? "Another action is in progress"
        : circleOnlyMode && drawTool !== "circle"
          ? "Current curse restricts map tools to circles only"
          : drawTool === "circle"
            ? draftEffectivePolygon.length < 1
              ? "Tap map to set circle center"
              : circleRadiusM <= 0
                ? "Circle radius must be greater than 0"
                : null
            : drawTool === "polygon"
              ? draftEffectivePolygon.length < 3
                ? "Polygon needs at least 3 vertices"
                : null
              : draftEffectivePolygon.length < 2
                ? `${drawTool === "measure" ? "Measurement" : "Line"} needs at least 2 points`
                : null;

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
    (cardBusy ? "Submitting..." : null) ??
    baseActionReason("castCurse") ??
    (!selectedCurseCardId ? "No curse card selected" : null);
  const powerupReason =
    (cardBusy ? "Submitting..." : null) ??
    baseActionReason("castCurse") ??
    (!selectedPowerupCardId ? "No powerup card selected" : null) ??
    (selectedPowerupKind === "veto_pending_question" && !pendingQuestionId
      ? "No pending question to veto"
      : null) ??
    (selectedPowerupKind === "randomize_pending_question" && !pendingQuestionId
      ? "No pending question to randomize"
      : null) ??
    (selectedPowerupKind === "discard_draw" && selectedDiscardCardIds.length !== selectedPowerupDiscardCount
      ? `Select exactly ${selectedPowerupDiscardCount} discard card${selectedPowerupDiscardCount === 1 ? "" : "s"}`
      : null);

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
    setCardError(null);
    await onPerformRoundAction("castCurse", {
      playerId,
      cardId: selectedCurseCardId,
    });
  };

  const toggleDiscardCard = useCallback((cardId: string) => {
    setSelectedDiscardCardIds((prev) => {
      if (prev.includes(cardId)) {
        return prev.filter((item) => item !== cardId);
      }
      if (prev.length >= selectedPowerupDiscardCount) {
        return [...prev.slice(1), cardId];
      }
      return [...prev, cardId];
    });
  }, [selectedPowerupDiscardCount]);

  const handleUsePowerup = useCallback(async () => {
    if (powerupReason || !selectedPowerupCardId) {
      return;
    }
    setCardBusy(true);
    setCardError(null);
    try {
      await castPlayerCard(httpBaseUrl, roomCode, {
        playerId,
        cardId: selectedPowerupCardId,
        discardCardIds: selectedPowerupKind === "discard_draw" ? selectedDiscardCardIds : undefined,
      });
      setSelectedDiscardCardIds([]);
      await onRefreshProjection();
    } catch (caught) {
      setCardError(caught instanceof Error ? caught.message : "Failed to use powerup");
    } finally {
      setCardBusy(false);
    }
  }, [
    httpBaseUrl,
    onRefreshProjection,
    playerId,
    powerupReason,
    roomCode,
    selectedDiscardCardIds,
    selectedPowerupCardId,
    selectedPowerupKind,
  ]);

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

  const pickEvidenceFromLibrary = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setEvidenceError("Photo library permission is required");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });
    if (result.canceled || result.assets.length === 0) {
      return;
    }

    const asset = result.assets[0];
    setEvidenceError(null);
    setSelectedEvidenceAsset({
      uri: asset.uri,
      fileName: asset.fileName ?? null,
      mimeType: asset.mimeType ?? null,
      fileSize: asset.fileSize ?? null,
      width: asset.width,
      height: asset.height,
    });
  }, []);

  const captureEvidencePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setEvidenceError("Camera permission is required");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });
    if (result.canceled || result.assets.length === 0) {
      return;
    }

    const asset = result.assets[0];
    setEvidenceError(null);
    setSelectedEvidenceAsset({
      uri: asset.uri,
      fileName: asset.fileName ?? null,
      mimeType: asset.mimeType ?? null,
      fileSize: asset.fileSize ?? null,
      width: asset.width,
      height: asset.height,
    });
  }, []);

  const handleUploadEvidence = useCallback(async () => {
    if (!selectedEvidenceAsset) {
      return;
    }

    setEvidenceBusy(true);
    setEvidenceError(null);
    setEvidenceProgress(0.05);

    try {
      const metadata: Record<string, unknown> = {
        note: evidenceNote.trim() || null,
        selectedPlaceId: selectedPlace?.placeId ?? null,
        selectedPlaceName: selectedPlace?.name ?? null,
        width: selectedEvidenceAsset.width ?? null,
        height: selectedEvidenceAsset.height ?? null,
      };
      const init = await initEvidenceUpload(httpBaseUrl, roomCode, {
        playerId,
        type: evidenceType,
        mimeType: selectedEvidenceAsset.mimeType ?? "image/jpeg",
        metadata,
      });
      setEvidenceProgress(0.15);

      const binaryResult = await uploadEvidenceBinary(httpBaseUrl, init.upload.uploadUrl, {
        uri: selectedEvidenceAsset.uri,
        mimeType: selectedEvidenceAsset.mimeType ?? "application/octet-stream",
        fileName: selectedEvidenceAsset.fileName ?? `${evidenceType}-${Date.now()}.jpg`,
        onProgress: (progress) => {
          setEvidenceProgress(0.15 + progress * 0.75);
        },
      });

      await completeEvidenceUpload(httpBaseUrl, roomCode, {
        playerId,
        evidenceId: init.upload.evidenceId,
        storageKey: binaryResult.upload.storageKey,
        fileName: binaryResult.upload.fileName,
        mimeType: binaryResult.upload.mimeType,
        sizeBytes: binaryResult.upload.sizeBytes,
        viewUrl: binaryResult.upload.viewUrl,
        metadata,
      });
      setEvidenceProgress(1);
      setSelectedEvidenceAsset(null);
      setEvidenceNote("");
      await onRefreshProjection();
    } catch (caught) {
      setEvidenceError(caught instanceof Error ? caught.message : "Evidence upload failed");
    } finally {
      setEvidenceBusy(false);
      setTimeout(() => setEvidenceProgress(0), 400);
    }
  }, [
    evidenceNote,
    evidenceType,
    httpBaseUrl,
    onRefreshProjection,
    playerId,
    roomCode,
    selectedEvidenceAsset,
    selectedPlace,
  ]);

  const handleCreateDispute = useCallback(async () => {
    setDisputeBusy(true);
    setDisputeError(null);
    try {
      const payload: Record<string, unknown> = {};
      if (disputeType === "place_legitimacy") {
        payload.placeId = selectedPlace?.placeId ?? null;
        payload.placeName = selectedPlace?.name ?? null;
        payload.place = selectedPlace ?? null;
      } else if (disputeType === "evidence_review") {
        payload.evidenceId = selectedDisputeEvidenceId;
      }

      await createDispute(httpBaseUrl, roomCode, {
        playerId,
        type: disputeType,
        description: disputeDescription.trim(),
        payload,
        autoPause: true,
      });
      setDisputeDescription("");
      await onRefreshProjection();
    } catch (caught) {
      setDisputeError(caught instanceof Error ? caught.message : "Failed to create dispute");
    } finally {
      setDisputeBusy(false);
    }
  }, [
    disputeDescription,
    disputeType,
    httpBaseUrl,
    onRefreshProjection,
    playerId,
    roomCode,
    selectedDisputeEvidenceId,
    selectedPlace,
  ]);

  const handleVoteDispute = useCallback(async (disputeId: string, vote: "accept" | "reject") => {
    setVoteBusyDisputeId(disputeId);
    setDisputeError(null);
    try {
      await voteDispute(httpBaseUrl, roomCode, disputeId, {
        playerId,
        vote,
        resumeAfterResolve: true,
      });
      await onRefreshProjection();
    } catch (caught) {
      setDisputeError(caught instanceof Error ? caught.message : "Failed to vote dispute");
    } finally {
      setVoteBusyDisputeId(null);
    }
  }, [httpBaseUrl, onRefreshProjection, playerId, roomCode]);

  const handleSendChat = useCallback(async () => {
    if (!chatInput.trim()) {
      return;
    }
    setChatBusy(true);
    setChatError(null);
    try {
      if (composerMode === "clue") {
        await sendClue(httpBaseUrl, roomCode, {
          playerId,
          text: chatInput.trim(),
        });
      } else {
        await sendChatMessage(httpBaseUrl, roomCode, {
          playerId,
          text: chatInput.trim(),
        });
      }
      setChatInput("");
      await onRefreshProjection();
    } catch (caught) {
      setChatError(caught instanceof Error ? caught.message : `Failed to send ${composerMode}`);
    } finally {
      setChatBusy(false);
    }
  }, [chatInput, composerMode, httpBaseUrl, onRefreshProjection, playerId, roomCode]);

  const handleResolveCatch = useCallback(async (result: "success" | "failed") => {
    if (!pendingCatchClaimId) {
      return;
    }
    await resolveCatch(httpBaseUrl, roomCode, pendingCatchClaimId, {
      playerId,
      result,
    });
    await onRefreshProjection();
  }, [httpBaseUrl, onRefreshProjection, pendingCatchClaimId, playerId, roomCode]);

  const evidenceUploadReason =
    evidenceBusy
      ? "Uploading..."
      : !selectedEvidenceAsset
        ? "Choose or capture a photo first"
        : null;
  const disputeCreateReason =
    disputeBusy
      ? "Submitting..."
      : !pendingCatchClaimId
        ? "Open disputes during catch review"
        : disputeType === "place_legitimacy" && !String(selectedPlace?.placeId ?? "").trim()
        ? "Inspect and select a POI before opening a place dispute"
        : disputeType === "evidence_review" && !selectedDisputeEvidenceId
          ? "Choose an evidence item first"
          : !disputeDescription.trim()
            ? "Dispute description is required"
            : null;
  const chatReason =
    chatBusy
      ? "Sending..."
      : composerMode === "clue" && (!isHider || capabilities.canShareClue !== true)
        ? "Clue is unavailable right now"
        : !chatInput.trim()
          ? "Type a room message"
          : null;
  const evidenceBaseUrl = httpBaseUrl.replace(/\/+$/, "");

  const hero = getRoleHero(meRole);

  return (
    <View style={styles.wrap}>
      <View style={[styles.heroCard, hero.accentStyle]}>
        <Text style={styles.heroEyebrow}>{hero.eyebrow}</Text>
        <Text style={styles.heroTitle}>{hero.title}</Text>
        <Text style={styles.heroDesc}>{hero.desc}</Text>
        <View style={styles.badgeRow}>
          <Text style={styles.badge}>Seek Elapsed {formatCountdownMs(liveSeekElapsedSeconds * 1000)}</Text>
          <Text style={styles.badge}>Lookup {String(projection?.mapProvider ?? "auto")}</Text>
          <Text style={styles.badge}>Transit {String(projection?.transitPackId ?? "default")}</Text>
        </View>
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
            <Text style={styles.badge}>Map {String(projection?.mapProvider ?? "-")}</Text>
            <Text style={styles.badge}>Perm {locationPermission.toUpperCase()}</Text>
            <Text style={styles.badge}>Mode {trackingMode === "background" ? "BG" : "FG"}</Text>
            {lastAccuracyM !== null ? <Text style={styles.badge}>Acc {Math.round(lastAccuracyM)}m</Text> : null}
            {configBoundaryPoints.length >= 3 ? <Text style={styles.badge}>Boundary ON</Text> : null}
            {configHidingAreaPoints.length >= 3 ? <Text style={styles.badge}>Hide Area ON</Text> : null}
            {canDrawMap ? <Text style={styles.badge}>Vertices {draftEffectivePolygon.length}</Text> : null}
          </View>

          <MapView
            ref={mapRef}
            style={styles.mapView}
            initialRegion={mapRegion ?? DEFAULT_REGION}
            onRegionChangeComplete={(region: Region) => setMapRegion(region)}
            onPress={handleMapPress}
          >
            {showBoundaryLayer && configBoundaryPoints.length >= 3 ? (
              <Polygon
                coordinates={configBoundaryPoints}
                strokeColor="#145b60"
                fillColor="rgba(20,91,96,0.08)"
                strokeWidth={2}
              />
            ) : null}
            {showHidingAreaLayer && configHidingAreaPoints.length >= 3 ? (
              <Polygon
                coordinates={configHidingAreaPoints}
                strokeColor="#8f3f68"
                fillColor="rgba(143,63,104,0.08)"
                strokeWidth={2}
              />
            ) : null}
            {visibleAnnotationPolygons.map((annotation) => (
              <Polygon
                key={annotation.id || `${annotation.layer}-${annotation.label}`}
                coordinates={annotation.points}
                strokeColor={annotation.colors.stroke}
                fillColor={annotation.colors.fill}
                strokeWidth={2}
              />
            ))}
            {visibleAnnotationLines.map((annotation) => (
              <Polyline
                key={annotation.id || `${annotation.layer}-${annotation.label}`}
                coordinates={annotation.points}
                strokeColor={annotation.colors.stroke}
                strokeWidth={3}
              />
            ))}
            {visibleAnnotationCircles.map((annotation) => (
              <Circle
                key={annotation.id || `${annotation.layer}-${annotation.label}`}
                center={annotation.circle.center}
                radius={annotation.circle.radiusM}
                strokeColor={annotation.colors.stroke}
                fillColor={annotation.colors.fill}
                strokeWidth={2}
              />
            ))}
            {(drawTool === "line" || drawTool === "measure") && draftPolygon.length >= 2 ? (
              <Polyline coordinates={draftPolygon} strokeColor="#1d7a4c" strokeWidth={2} />
            ) : null}
            {drawTool === "polygon" && draftPolygon.length >= 2 ? (
              <Polyline coordinates={draftPolygon} strokeColor="#1d7a4c" strokeWidth={2} />
            ) : null}
            {drawTool === "polygon" && draftPolygon.length >= 3 ? (
              <Polygon
                coordinates={draftPolygon}
                strokeColor="#1d7a4c"
                fillColor="rgba(29,122,76,0.14)"
                strokeWidth={2}
              />
            ) : null}
            {drawTool === "circle" && draftPolygon.length >= 1 && circleRadiusM > 0 ? (
              <Circle
                center={draftPolygon[0]}
                radius={circleRadiusM}
                strokeColor="#1d7a4c"
                fillColor="rgba(29,122,76,0.14)"
                strokeWidth={2}
              />
            ) : null}
            {showPlayerMarkers ? playerMarkers.map((marker) => (
              <Marker
                key={`player-${marker.id}`}
                coordinate={marker.coordinate}
                pinColor={marker.isMe ? "#0a5f66" : marker.role === "hider" ? "#8f3f68" : "#c76528"}
                title={`${marker.name}${marker.isMe ? " (You)" : ""}`}
                description={`${marker.role} | ${marker.ready ? "ready" : "not ready"}`}
              />
            )) : null}
            {showPoiMarkers ? poiResults.map((place, index) => {
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
            }) : null}
            {showSelectedPoiMarker && selectedPlaceCoordinate ? (
              <Marker
                coordinate={selectedPlaceCoordinate}
                pinColor="#6a4db0"
                title={String(selectedPlace?.name ?? "Selected POI")}
                description={String(selectedPlace?.placeId ?? "selected_place")}
              />
            ) : null}
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
              <Text style={styles.panelTitle}>Map Tools</Text>
              <View style={styles.optionWrap}>
                {DRAW_TOOL_OPTIONS.map((item) => {
                  const active = drawTool === item.key;
                  const disabled = circleOnlyMode && item.key !== "circle";
                  return (
                    <Pressable
                      key={item.key}
                      style={[
                        styles.toolButton,
                        active ? styles.toolButtonActive : null,
                        disabled ? styles.buttonDisabled : null,
                      ]}
                      onPress={() => setDrawTool(item.key)}
                      disabled={disabled}
                    >
                      <Text style={[styles.toolButtonText, active ? styles.toolButtonTextActive : null]}>
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.mutedText}>
                Active tool {drawTool.toUpperCase()} | draft points {draftEffectivePolygon.length} | distance {formatDistanceLabel(draftDistanceMeters)}
              </Text>
              <Text style={styles.noteText}>
                If tapping vertices feels awkward, search a POI first and use Add Vertex from the result list. For polygons, tapping near the first point snaps the shape closed.
              </Text>
              <TextInput
                value={annotationLayer}
                onChangeText={setAnnotationLayer}
                placeholder="Annotation layer"
                style={styles.input}
                editable={!circleOnlyMode || drawTool === "circle"}
              />
              <View style={styles.optionWrap}>
                {MAP_LAYER_OPTIONS.map((item) => {
                  const active = annotationLayer === item;
                  return (
                    <Pressable
                      key={item}
                      style={[styles.choiceButton, active ? styles.choiceButtonActive : null]}
                      onPress={() => setAnnotationLayer(item)}
                    >
                      <Text style={[styles.choiceButtonText, active ? styles.choiceButtonTextActive : null]}>
                        {item}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                value={annotationLabel}
                onChangeText={setAnnotationLabel}
                placeholder="Annotation label"
                style={styles.input}
              />
              {drawTool === "circle" ? (
                <TextInput
                  value={circleRadiusText}
                  onChangeText={setCircleRadiusText}
                  placeholder="Circle radius meters"
                  keyboardType="numeric"
                  style={styles.input}
                />
              ) : null}
              <View style={styles.row}>
                <Pressable
                  style={[styles.secondaryButton, !myLocation ? styles.buttonDisabled : null]}
                  disabled={!myLocation}
                  onPress={handleAppendMyLocation}
                >
                  <Text style={styles.secondaryButtonText}>Use My Location</Text>
                </Pressable>
                <Pressable
                  style={[styles.secondaryButton, !selectedPlaceCoordinate ? styles.buttonDisabled : null]}
                  disabled={!selectedPlaceCoordinate}
                  onPress={() => selectedPlace ? handleAppendPlaceToPolygon(selectedPlace) : null}
                >
                  <Text style={styles.secondaryButtonText}>Use Selected POI</Text>
                </Pressable>
              </View>
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
                style={[styles.primaryButton, drawSaveReason || mapBusy ? styles.buttonDisabled : null]}
                disabled={Boolean(drawSaveReason) || mapBusy}
                onPress={() => void handleSaveDraftAnnotation()}
              >
                <Text style={styles.primaryButtonText}>{mapBusy ? "Saving..." : "Save Annotation"}</Text>
              </Pressable>
              {drawSaveReason ? <Text style={styles.noteText}>{drawSaveReason}</Text> : null}
              {mapError ? <Text style={styles.reasonText}>{mapError}</Text> : null}

              <View style={styles.separator} />
              <Text style={styles.panelTitle}>Layer Visibility</Text>
              <View style={styles.optionWrap}>
                <Pressable
                  style={[styles.choiceButton, showBoundaryLayer ? styles.choiceButtonActive : null]}
                  onPress={() => setShowBoundaryLayer((prev) => !prev)}
                >
                  <Text style={[styles.choiceButtonText, showBoundaryLayer ? styles.choiceButtonTextActive : null]}>
                    Boundary
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.choiceButton, showHidingAreaLayer ? styles.choiceButtonActive : null]}
                  onPress={() => setShowHidingAreaLayer((prev) => !prev)}
                >
                  <Text style={[styles.choiceButtonText, showHidingAreaLayer ? styles.choiceButtonTextActive : null]}>
                    Hide Area
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.choiceButton, showPlayerMarkers ? styles.choiceButtonActive : null]}
                  onPress={() => setShowPlayerMarkers((prev) => !prev)}
                >
                  <Text style={[styles.choiceButtonText, showPlayerMarkers ? styles.choiceButtonTextActive : null]}>
                    Players
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.choiceButton, showPoiMarkers ? styles.choiceButtonActive : null]}
                  onPress={() => setShowPoiMarkers((prev) => !prev)}
                >
                  <Text style={[styles.choiceButtonText, showPoiMarkers ? styles.choiceButtonTextActive : null]}>
                    POI Results
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.choiceButton, showSelectedPoiMarker ? styles.choiceButtonActive : null]}
                  onPress={() => setShowSelectedPoiMarker((prev) => !prev)}
                >
                  <Text style={[styles.choiceButtonText, showSelectedPoiMarker ? styles.choiceButtonTextActive : null]}>
                    Selected POI
                  </Text>
                </Pressable>
                {annotationLayerItems.map((item) => {
                  const active = visibleLayerLookup[item.layer] !== false;
                  return (
                    <Pressable
                      key={item.layer}
                      style={[styles.choiceButton, active ? styles.choiceButtonActive : null]}
                      onPress={() => setLayerVisibility((prev) => ({
                        ...prev,
                        [item.layer]: !(prev[item.layer] !== false),
                      }))}
                    >
                      <Text style={[styles.choiceButtonText, active ? styles.choiceButtonTextActive : null]}>
                        {item.layer} ({item.count})
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.separator} />
              <Text style={styles.panelTitle}>POI Search</Text>
              <Text style={styles.noteText}>
                Leave the query blank for nearby demo places, or try Temple / Square / Park / Station / Cafe.
              </Text>
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
              {selectedPlace ? (
                <>
                  <View style={styles.separator} />
                  <Text style={styles.panelTitle}>Selected Place</Text>
                  <View style={styles.statusCard}>
                    <Text style={styles.statusEyebrow}>POI Inspection</Text>
                    <Text style={styles.statusTitle}>
                      {String(selectedPlace.name ?? selectedPlaceDetailsData.name ?? "Selected place")}
                    </Text>
                    <Text style={styles.statusBody}>
                      Categories {Array.isArray(selectedPlaceDetailsData.categories)
                        ? selectedPlaceDetailsData.categories.join(", ")
                        : "unknown"}
                    </Text>
                    <Text style={styles.statusBody}>
                      Distance from you {formatDistanceLabel(distanceFromMeToSelectedPlace)} | map center {formatDistanceLabel(distanceFromMapCenterToSelectedPlace)}
                    </Text>
                    <Text style={styles.statusBody}>
                      Reviews {String(selectedPlaceDetailsData.review_count ?? "-")} | legitimacy {typeof selectedPlaceLegitimacyData.isLegitimate === "boolean"
                        ? (selectedPlaceLegitimacyData.isLegitimate ? "PASS" : "FAIL")
                        : "-"} | rule {String(selectedPlaceLegitimacyData.rule ?? "-")}
                    </Text>
                    <Text style={styles.statusBody}>
                      Admin {formatAdminLevels(selectedPlaceAdminLevels ?? selectedPlaceDetailsData.adminLevels)}
                    </Text>
                  </View>
                  <View style={styles.row}>
                    <Pressable
                      style={[styles.secondaryButton, selectedPlaceLoading ? styles.buttonDisabled : null]}
                      disabled={selectedPlaceLoading}
                      onPress={() => void handleInspectPlace(selectedPlace)}
                    >
                      <Text style={styles.secondaryButtonText}>{selectedPlaceLoading ? "Inspecting..." : "Refresh Details"}</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.secondaryButton, !selectedPlaceCoordinate ? styles.buttonDisabled : null]}
                      disabled={!selectedPlaceCoordinate}
                      onPress={handleCenterOnSelectedPlace}
                    >
                      <Text style={styles.secondaryButtonText}>Center On POI</Text>
                    </Pressable>
                    <Pressable style={styles.secondaryButton} onPress={() => setSelectedPlace(null)}>
                      <Text style={styles.secondaryButtonText}>Clear POI</Text>
                    </Pressable>
                  </View>
                  {selectedPlaceError ? <Text style={styles.reasonText}>{selectedPlaceError}</Text> : null}
                </>
              ) : null}

              <ScrollView style={styles.smallScroll} contentContainerStyle={styles.stack}>
                {poiResults.length === 0 ? (
                  <Text style={styles.mutedText}>No POI results yet</Text>
                ) : (
                  poiResults.map((place, index) => (
                    <View
                      key={`poi-row-${String(place.placeId ?? index)}`}
                      style={[
                        styles.cardRow,
                        String(selectedPlace?.placeId ?? "") === String(place.placeId ?? "") ? styles.cardSelected : null,
                      ]}
                    >
                      <View style={styles.fill}>
                        <Text
                          style={[
                            styles.cardTitle,
                            String(selectedPlace?.placeId ?? "") === String(place.placeId ?? "") ? styles.cardTitleSelected : null,
                          ]}
                        >
                          {String(place.name ?? "POI")}
                        </Text>
                        <Text style={styles.cardMeta}>{Math.round(Number(place.distanceMeters ?? 0))}m</Text>
                      </View>
                      <View style={styles.row}>
                        <Pressable style={styles.secondaryButton} onPress={() => void handleInspectPlace(place)}>
                          <Text style={styles.secondaryButtonText}>Inspect</Text>
                        </Pressable>
                        <Pressable style={styles.secondaryButton} onPress={() => handleAppendPlaceToPolygon(place)}>
                          <Text style={styles.secondaryButtonText}>Add Vertex</Text>
                        </Pressable>
                      </View>
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
          {curseCards.length === 0 ? (
            <Text style={styles.mutedText}>No curse cards available</Text>
          ) : (
            <>
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
              <Text style={styles.noteText}>Curse cards now affect every active seeker, so no single-target selection is required.</Text>

              <Pressable
                style={[styles.primaryButton, castReason ? styles.buttonDisabled : null]}
                disabled={Boolean(castReason)}
                onPress={() => void handleCastCurse()}
              >
                <Text style={styles.primaryButtonText}>Cast To All Seekers</Text>
              </Pressable>
              {castReason ? <Text style={styles.reasonText}>{castReason}</Text> : null}
            </>
          )}

          <View style={styles.separator} />
          <Text style={styles.panelTitle}>Use Powerup</Text>
          {powerupCards.length === 0 ? (
            <Text style={styles.mutedText}>No powerup cards available</Text>
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
                {powerupCards.map((card) => {
                  const cid = getCardId(card);
                  const selected = selectedPowerupCardId === cid;
                  return (
                    <Pressable
                      key={cid}
                      style={[styles.tabButton, selected ? styles.tabButtonActive : null]}
                      onPress={() => setSelectedPowerupCardId(cid)}
                    >
                      <Text style={[styles.tabButtonText, selected ? styles.tabButtonTextActive : null]}>
                        {getCardTitle(card)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {selectedPowerupCard ? (
                <View style={styles.statusCard}>
                  <Text style={styles.statusEyebrow}>Selected Powerup</Text>
                  <Text style={styles.statusTitle}>{getCardTitle(selectedPowerupCard)}</Text>
                  <Text style={styles.statusBody}>{describePowerup(selectedPowerupCard)}</Text>
                </View>
              ) : null}

              {selectedPowerupKind === "discard_draw" ? (
                <>
                  <Text style={styles.noteText}>
                    Select {selectedPowerupDiscardCount} discard card{selectedPowerupDiscardCount === 1 ? "" : "s"} from the rest of your hand.
                  </Text>
                  <View style={styles.stack}>
                    {discardableCards.length === 0 ? (
                      <Text style={styles.mutedText}>No other cards are available to discard.</Text>
                    ) : (
                      discardableCards.map((card) => {
                        const cardId = getCardId(card);
                        const selected = selectedDiscardCardIds.includes(cardId);
                        return (
                          <Pressable
                            key={cardId || getCardTitle(card)}
                            style={[styles.card, selected ? styles.cardSelected : null]}
                            onPress={() => toggleDiscardCard(cardId)}
                          >
                            <Text style={[styles.cardTitle, selected ? styles.cardTitleSelected : null]}>
                              {getCardTitle(card)}
                            </Text>
                            <Text style={styles.cardMeta}>{getCardMeta(card)}</Text>
                          </Pressable>
                        );
                      })
                    )}
                  </View>
                </>
              ) : null}

              <Pressable
                style={[styles.primaryButton, powerupReason ? styles.buttonDisabled : null]}
                disabled={Boolean(powerupReason)}
                onPress={() => void handleUsePowerup()}
              >
                <Text style={styles.primaryButtonText}>{cardBusy ? "Using..." : "Use Powerup"}</Text>
              </Pressable>
              {powerupReason ? <Text style={styles.reasonText}>{powerupReason}</Text> : null}
            </>
          )}

          {timeBonusCards.length > 0 ? (
            <Text style={styles.noteText}>
              Time bonus cards are passive and score automatically during catch/summary. They are not manually cast.
            </Text>
          ) : null}
          {cardError ? <Text style={styles.reasonText}>{cardError}</Text> : null}
        </View>
      ) : null}

      {activeTab === "tools" ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Tools Hub</Text>
          <ScrollView style={styles.tallScroll} contentContainerStyle={styles.stack}>
            <View style={styles.statusCard}>
              <Text style={styles.statusEyebrow}>Dice</Text>
              <Text style={styles.statusTitle}>Quick randomizer</Text>
              <Text style={styles.statusBody}>Use this for lightweight rulings or card side-effects.</Text>
            </View>
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
            <View style={styles.separator} />
            <View style={styles.statusCard}>
              <Text style={styles.statusEyebrow}>Map + Transit Notes</Text>
              <Text style={styles.statusTitle}>Provider drives lookup, not the native map skin</Text>
              <Text style={styles.statusBody}>
                Provider now resolves automatically from room geography. Current lookup source {String(projection?.mapProvider ?? "auto")} controls POI/admin lookups. Transit pack {String(projection?.transitPackId ?? "default")} is used for station and route context, not a visual map theme.
              </Text>
            </View>
            <Text style={styles.noteText}>
              Photos and clue proof now belong in Comms. Formal disputes are opened from Catch Review only.
            </Text>
          </ScrollView>
        </View>
      ) : null}

      {activeTab === "comms" ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Room Comms</Text>
          {isHider ? (
            <View style={styles.optionWrap}>
              {(["chat", "clue"] as const).map((mode) => {
                const active = composerMode === mode;
                return (
                  <Pressable
                    key={mode}
                    style={[styles.choiceButton, active ? styles.choiceButtonActive : null]}
                    onPress={() => setComposerMode(mode)}
                  >
                    <Text style={[styles.choiceButtonText, active ? styles.choiceButtonTextActive : null]}>
                      {mode === "chat" ? "Chat" : "Clue"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <TextInput
            value={chatInput}
            onChangeText={setChatInput}
            placeholder={composerMode === "clue" ? "Share a clue to every seeker" : "Send a room message"}
            multiline
            style={[styles.input, styles.messageComposer]}
          />
          <Pressable
            style={[styles.primaryButton, chatReason ? styles.buttonDisabled : null]}
            disabled={Boolean(chatReason)}
            onPress={() => void handleSendChat()}
          >
            <Text style={styles.primaryButtonText}>{chatBusy ? "Sending..." : composerMode === "clue" ? "Send Clue" : "Send Message"}</Text>
          </Pressable>
          {chatReason ? <Text style={styles.noteText}>{chatReason}</Text> : null}
          {chatError ? <Text style={styles.reasonText}>{chatError}</Text> : null}

          <View style={styles.separator} />
          <Text style={styles.panelTitle}>Photo Evidence</Text>
          <View style={styles.optionWrap}>
            {["photo", "catch", "curse", "generic"].map((item) => {
              const active = evidenceType === item;
              return (
                <Pressable
                  key={item}
                  style={[styles.choiceButton, active ? styles.choiceButtonActive : null]}
                  onPress={() => setEvidenceType(item)}
                >
                  <Text style={[styles.choiceButtonText, active ? styles.choiceButtonTextActive : null]}>
                    {item}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.row}>
            <Pressable style={styles.secondaryButton} onPress={() => void pickEvidenceFromLibrary()}>
              <Text style={styles.secondaryButtonText}>Choose Photo</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => void captureEvidencePhoto()}>
              <Text style={styles.secondaryButtonText}>Take Photo</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, !selectedEvidenceAsset ? styles.buttonDisabled : null]}
              disabled={!selectedEvidenceAsset}
              onPress={() => setSelectedEvidenceAsset(null)}
            >
              <Text style={styles.secondaryButtonText}>Clear</Text>
            </Pressable>
          </View>
          {selectedEvidenceAsset ? (
            <View style={styles.statusCard}>
              <Text style={styles.statusEyebrow}>Pending Upload</Text>
              <Text style={styles.statusTitle}>{selectedEvidenceAsset.fileName ?? "Selected image"}</Text>
              <Text style={styles.statusBody}>
                {selectedEvidenceAsset.mimeType ?? "image"} | {formatFileSize(selectedEvidenceAsset.fileSize)}
              </Text>
              <Image source={{ uri: selectedEvidenceAsset.uri }} style={styles.evidencePreview} resizeMode="cover" />
            </View>
          ) : null}
          <TextInput
            value={evidenceNote}
            onChangeText={setEvidenceNote}
            placeholder="Evidence note / relation"
            style={styles.input}
          />
          <Pressable
            style={[styles.primaryButton, evidenceUploadReason ? styles.buttonDisabled : null]}
            disabled={Boolean(evidenceUploadReason)}
            onPress={() => void handleUploadEvidence()}
          >
            <Text style={styles.primaryButtonText}>
              {evidenceBusy ? `Uploading ${Math.round(evidenceProgress * 100)}%` : "Upload Evidence"}
            </Text>
          </Pressable>
          {evidenceUploadReason ? <Text style={styles.noteText}>{evidenceUploadReason}</Text> : null}
          {evidenceError ? <Text style={styles.reasonText}>{evidenceError}</Text> : null}

          <View style={styles.separator} />
          <Text style={styles.panelTitle}>Message Stream ({sortedMessages.length})</Text>
          <ScrollView style={styles.tallScroll} contentContainerStyle={styles.messageStream}>
            {sortedMessages.length === 0 ? (
              <Text style={styles.mutedText}>No room messages yet.</Text>
            ) : (
              sortedMessages.slice(-40).map((message) => {
                const senderName =
                  message.playerName ??
                  playerNameLookup[String(message.playerId ?? "")] ??
                  String(message.playerId ?? "System");
                const isClue = String(message.kind ?? "") === "clue";
                const isOwn = String(message.playerId ?? "") === playerId;
                return (
                  <View key={String(message.id ?? message.messageId ?? message.createdAt)} style={[styles.messageRow, isOwn ? styles.messageRowOwn : styles.messageRowOther]}>
                    <View style={[styles.messageBubble, isOwn ? styles.messageBubbleOwn : isClue ? styles.messageBubbleClue : styles.messageBubbleOther]}>
                      <Text style={[styles.messageMeta, isOwn ? styles.messageMetaOwn : null]}>
                        {isClue ? `Clue · ${senderName}` : senderName} · {formatClock(message.createdAt)}
                      </Text>
                      <Text style={[styles.messageText, isOwn ? styles.messageTextOwn : null]}>{String(message.text ?? "")}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          {sortedEvidenceItems.length > 0 ? (
            <>
              <View style={styles.separator} />
              <Text style={styles.panelTitle}>Evidence Library ({sortedEvidenceItems.length})</Text>
              <ScrollView style={styles.smallScroll} contentContainerStyle={styles.stack}>
                {sortedEvidenceItems.map((item) => {
                  const previewUrl = item.viewUrl ? `${evidenceBaseUrl}${item.viewUrl}` : null;
                  const selected = selectedDisputeEvidenceId === String(item.evidenceId ?? "");
                  return (
                    <Pressable
                      key={String(item.evidenceId ?? item.createdAt ?? Math.random())}
                      style={[styles.card, selected ? styles.cardSelected : null]}
                      onPress={() => item.evidenceId ? setSelectedDisputeEvidenceId(String(item.evidenceId)) : null}
                    >
                      <Text style={[styles.cardTitle, selected ? styles.cardTitleSelected : null]}>
                        {String(item.type ?? "evidence")} | {String(item.status ?? "unknown")}
                      </Text>
                      <Text style={styles.cardMeta}>
                        {playerNameLookup[String(item.actorPlayerId ?? "")] ?? String(item.actorPlayerId ?? "-")} | {formatFileSize(item.sizeBytes)} | {formatClock(item.completedAt ?? item.createdAt)}
                      </Text>
                      {typeof item.metadata?.note === "string" && item.metadata.note ? (
                        <Text style={styles.logData}>{String(item.metadata.note)}</Text>
                      ) : null}
                      {previewUrl && String(item.mimeType ?? "").startsWith("image/") ? (
                        <Image source={{ uri: previewUrl }} style={styles.evidenceThumbnail} resizeMode="cover" />
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          ) : null}
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

          {pendingCatchClaimId ? (
            <>
              <View style={styles.separator} />
              <View style={styles.statusCard}>
                <Text style={styles.statusEyebrow}>Pending Catch Review</Text>
                <Text style={styles.statusTitle}>Claim {pendingCatchClaimId}</Text>
                <Text style={styles.statusBody}>
                  Expires {formatClock(pendingCatchClaim.expiresAt)} | Review is now player-confirmed instead of instantly auto-failing.
                </Text>
              </View>
              {(isHider || meRole === "observer") ? (
                <View style={styles.row}>
                  <Pressable style={styles.secondaryButton} onPress={() => void handleResolveCatch("success")}>
                    <Text style={styles.secondaryButtonText}>Confirm Catch</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryButton} onPress={() => void handleResolveCatch("failed")}>
                    <Text style={styles.secondaryButtonText}>Reject Catch</Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={styles.noteText}>Waiting for hider or observer to confirm whether the round should end.</Text>
              )}

              <View style={styles.separator} />
              <Text style={styles.panelTitle}>Disputes</Text>
              <View style={styles.optionWrap}>
                {[
                  { key: "place_legitimacy", label: "Place" },
                  { key: "evidence_review", label: "Evidence" },
                  { key: "generic", label: "Generic" },
                ].map((item) => {
                  const active = disputeType === item.key;
                  return (
                    <Pressable
                      key={item.key}
                      style={[styles.choiceButton, active ? styles.choiceButtonActive : null]}
                      onPress={() => setDisputeType(item.key as DisputeDraftType)}
                    >
                      <Text style={[styles.choiceButtonText, active ? styles.choiceButtonTextActive : null]}>
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {disputeType === "place_legitimacy" ? (
                <Text style={styles.noteText}>
                  Target POI: {String(selectedPlace?.name ?? selectedPlace?.placeId ?? "Select a POI from Map first")}
                </Text>
              ) : null}
              {disputeType === "evidence_review" ? (
                <Text style={styles.noteText}>
                  Target evidence: {selectedDisputeEvidenceId || "Pick an evidence item in Comms"}
                </Text>
              ) : null}
              <TextInput
                value={disputeDescription}
                onChangeText={setDisputeDescription}
                placeholder="Why should this dispute be opened?"
                style={styles.input}
              />
              <Pressable
                style={[styles.primaryButton, disputeCreateReason ? styles.buttonDisabled : null]}
                disabled={Boolean(disputeCreateReason)}
                onPress={() => void handleCreateDispute()}
              >
                <Text style={styles.primaryButtonText}>{disputeBusy ? "Opening..." : "Open Dispute"}</Text>
              </Pressable>
              {disputeCreateReason ? <Text style={styles.noteText}>{disputeCreateReason}</Text> : null}
              {disputeError ? <Text style={styles.reasonText}>{disputeError}</Text> : null}

              {sortedDisputes.length === 0 ? (
                <Text style={styles.mutedText}>No disputes yet.</Text>
              ) : (
                sortedDisputes.map((dispute) => {
                  const disputeId = String(dispute.id ?? "");
                  const votes = dispute.votes && typeof dispute.votes === "object"
                    ? Object.entries(dispute.votes)
                    : [];
                  return (
                    <View key={disputeId || String(dispute.createdAt)} style={styles.card}>
                      <Text style={styles.cardTitle}>
                        {String(dispute.type ?? "dispute")} | {String(dispute.status ?? "open")}
                      </Text>
                      <Text style={styles.cardMeta}>
                        {playerNameLookup[String(dispute.createdBy ?? "")] ?? String(dispute.createdBy ?? "-")} | {formatClock(dispute.createdAt)}
                      </Text>
                      <Text style={styles.logData}>{String(dispute.description ?? "")}</Text>
                      <Text style={styles.cardMeta}>
                        Votes {votes.length}/{Array.isArray(dispute.requiredVoterIds) ? dispute.requiredVoterIds.length : 0}
                      </Text>
                      {dispute.status === "resolved" ? (
                        <Text style={styles.noteText}>
                          Resolution {String((dispute.resolution as Record<string, unknown> | null)?.decision ?? "unknown")}
                        </Text>
                      ) : (
                        <View style={styles.row}>
                          <Pressable
                            style={[styles.secondaryButton, voteBusyDisputeId === disputeId ? styles.buttonDisabled : null]}
                            disabled={voteBusyDisputeId === disputeId}
                            onPress={() => void handleVoteDispute(disputeId, "accept")}
                          >
                            <Text style={styles.secondaryButtonText}>Accept</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.secondaryButton, voteBusyDisputeId === disputeId ? styles.buttonDisabled : null]}
                            disabled={voteBusyDisputeId === disputeId}
                            onPress={() => void handleVoteDispute(disputeId, "reject")}
                          >
                            <Text style={styles.secondaryButtonText}>Reject</Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </>
          ) : null}
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
  optionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
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
  toolButton: {
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#c9c6ba",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  toolButtonActive: {
    borderColor: "#0a5f66",
    backgroundColor: "#d7eef0",
  },
  toolButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#565656",
  },
  toolButtonTextActive: {
    color: "#0a5f66",
  },
  choiceButton: {
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#cfcdbf",
    backgroundColor: "#f2f1ea",
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  choiceButtonActive: {
    borderColor: "#0a5f66",
    backgroundColor: "#d7eef0",
  },
  choiceButtonText: {
    color: "#5a5a5a",
    fontSize: 12,
    fontWeight: "700",
  },
  choiceButtonTextActive: {
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
  tallScroll: {
    maxHeight: 480,
  },
  stack: {
    gap: 8,
    paddingBottom: 6,
  },
  messageStream: {
    gap: 10,
    paddingBottom: 8,
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
  cardClue: {
    borderColor: "#d2b86d",
    backgroundColor: "#f7f0dc",
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
  evidencePreview: {
    width: "100%",
    height: 180,
    borderRadius: 10,
    marginTop: 6,
    backgroundColor: "#e7e4da",
  },
  messageComposer: {
    minHeight: 108,
    textAlignVertical: "top",
  },
  messageRow: {
    flexDirection: "row",
  },
  messageRowOwn: {
    justifyContent: "flex-end",
  },
  messageRowOther: {
    justifyContent: "flex-start",
  },
  messageBubble: {
    maxWidth: "84%",
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  messageBubbleOwn: {
    backgroundColor: "#0a5f66",
  },
  messageBubbleOther: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d6d4cc",
  },
  messageBubbleClue: {
    backgroundColor: "#dff3d9",
    borderWidth: 1,
    borderColor: "#9dc48f",
  },
  messageMeta: {
    fontSize: 10,
    color: "#667085",
    fontWeight: "700",
  },
  messageMetaOwn: {
    color: "rgba(255,255,255,0.8)",
  },
  messageText: {
    fontSize: 13,
    color: "#1d2939",
    lineHeight: 18,
  },
  messageTextOwn: {
    color: "#ffffff",
  },
  evidenceThumbnail: {
    width: "100%",
    height: 140,
    borderRadius: 8,
    marginTop: 8,
    backgroundColor: "#ece9df",
  },
  logData: {
    fontSize: 11,
    color: "#4f4f4f",
  },
});
