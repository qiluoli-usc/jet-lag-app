import { ChangeEvent, MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  addMapAnnotation,
  castPlayerCard,
  chooseRewardCards,
  completeEvidenceUpload,
  createDispute,
  fetchRoomPlaceDetails,
  initEvidenceUpload,
  reverseRoomAdminLevels,
  searchRoomPlaces,
  sendChatMessage,
  sendClue,
  toPlaceCenter,
  updatePlayerLocation,
  uploadEvidenceBinary,
  voteDispute,
  resolveCatch,
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
import type {
  MapPlace,
  PendingRewardChoiceProjection,
  ProjectionMapAnnotation,
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
  onRefreshProjection: () => Promise<void>;
  onPerformRoundAction: (action: RoundAction, payload: Record<string, unknown>) => Promise<void>;
}

type TabKey = "map" | "qa" | "cards" | "rewards" | "tools" | "comms" | "catch" | "log";
type DrawTool = "polygon" | "line" | "circle" | "measure";
type DisputeDraftType = "place_legitimacy" | "evidence_review" | "generic";
type Point = { lat: number; lng: number };
type PlotPoint = { x: number; y: number };
type PlotBounds = { minLat: number; maxLat: number; minLng: number; maxLng: number };

const SEEKER_TABS: Array<{ key: TabKey; label: string }> = [
  { key: "map", label: "Map" },
  { key: "qa", label: "Ask" },
  { key: "catch", label: "Catch" },
  { key: "tools", label: "Tools" },
  { key: "comms", label: "Comms" },
  { key: "log", label: "Log" },
];

const HIDER_TABS: Array<{ key: TabKey; label: string }> = [
  { key: "map", label: "Map" },
  { key: "qa", label: "Answer" },
  { key: "rewards", label: "Rewards" },
  { key: "cards", label: "Cards" },
  { key: "tools", label: "Tools" },
  { key: "comms", label: "Comms" },
  { key: "log", label: "Log" },
];

const OBSERVER_TABS: Array<{ key: TabKey; label: string }> = [
  { key: "map", label: "Map" },
  { key: "tools", label: "Tools" },
  { key: "comms", label: "Comms" },
  { key: "log", label: "Log" },
];

const DEFAULT_QUESTION_DEFS: QuestionDef[] = [
  { key: "matching", label: "Matching" },
  { key: "measuring", label: "Measuring" },
  { key: "radar", label: "Radar" },
  { key: "thermometer", label: "Thermometer" },
  { key: "photo", label: "Photo" },
];

const ACTION_REASON_FALLBACK: Record<RoundAction, string> = {
  ask: "Ask unavailable right now",
  answer: "Answer unavailable right now",
  drawCard: "Draw unavailable right now",
  castCurse: "Cast unavailable right now",
  rollDice: "Dice unavailable right now",
  claimCatch: "Catch unavailable right now",
};

const DRAW_TOOLS: Array<{ key: DrawTool; label: string }> = [
  { key: "polygon", label: "Polygon" },
  { key: "line", label: "Line" },
  { key: "circle", label: "Circle" },
  { key: "measure", label: "Measure" },
];

const LAYER_OPTIONS = ["possible_area", "route_guess", "scan_zone", "measurement"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown, fallback = "-"): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function shortJson(value: unknown): string {
  try {
    const encoded = JSON.stringify(value);
    return encoded.length > 180 ? `${encoded.slice(0, 180)}...` : encoded;
  } catch {
    return "{...}";
  }
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pointFromUnknown(value: unknown): Point | null {
  const row = asRecord(value);
  const lat = toFiniteNumber(row.lat) ?? toFiniteNumber(row.latitude);
  const lng = toFiniteNumber(row.lng) ?? toFiniteNumber(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat: Number(lat), lng: Number(lng) };
}

function distanceMeters(a: Point, b: Point): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  return 2 * earthRadius * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function formatDistance(value: number | null): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (Number(value) >= 1000) {
    return `${(Number(value) / 1000).toFixed(2)} km`;
  }
  return `${Math.round(Number(value))} m`;
}

function formatDateTime(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "-";
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : value;
}

function formatCountdownMs(value: number): string {
  const safe = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getCardId(card: Record<string, unknown>): string {
  return String(card.id ?? "").trim();
}

function getCardTitle(card: Record<string, unknown>): string {
  return asText(card.name, asText(card.templateId, "card"));
}

function getCardEffectKind(card: Record<string, unknown>): string {
  return String(asRecord(card.effect).kind ?? "").trim().toLowerCase();
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

function parsePositiveInt(text: string, fallbackValue: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(text).trim(), 10);
  if (!Number.isInteger(parsed)) {
    return fallbackValue;
  }
  return Math.max(min, Math.min(max, parsed));
}

function extractConfigPolygonPoints(value: unknown): Point[] {
  const source = asRecord(value);
  const geometry = String(source.type ?? "").toLowerCase() === "feature" ? asRecord(source.geometry) : source;
  const coordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  const ring = Array.isArray(coordinates[0]) ? coordinates[0] : [];
  const points = ring
    .map((item) => Array.isArray(item) && item.length >= 2 ? pointFromUnknown({ lng: item[0], lat: item[1] }) : null)
    .filter((item): item is Point => Boolean(item));

  if (points.length >= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first.lat === last.lat && first.lng === last.lng) {
      return points.slice(0, -1);
    }
  }
  return points;
}

function extractPolygonPoints(annotation: ProjectionMapAnnotation): Point[] {
  const geometry = asRecord(annotation.geometry);
  const candidates =
    (Array.isArray(geometry.vertices) ? geometry.vertices : null) ??
    (Array.isArray(geometry.points) ? geometry.points : null) ??
    (Array.isArray(geometry.coordinates) ? geometry.coordinates : null) ??
    [];
  return candidates.map((item) => pointFromUnknown(item)).filter((item): item is Point => Boolean(item));
}

function extractCircleGeometry(annotation: ProjectionMapAnnotation): { center: Point; radiusM: number } | null {
  const geometry = asRecord(annotation.geometry);
  const center = pointFromUnknown(geometry.center);
  const radiusM = toFiniteNumber(geometry.radiusM);
  if (!center || !Number.isFinite(radiusM) || Number(radiusM) <= 0) {
    return null;
  }
  return { center, radiusM: Number(radiusM) };
}

function layerColors(layer: string): { stroke: string; fill: string } {
  if (layer === "measurement") {
    return { stroke: "#ef6c00", fill: "rgba(239,108,0,0.12)" };
  }
  if (layer === "route_guess") {
    return { stroke: "#2563eb", fill: "rgba(37,99,235,0.12)" };
  }
  if (layer === "scan_zone") {
    return { stroke: "#dc2626", fill: "rgba(220,38,38,0.12)" };
  }
  return { stroke: "#0f766e", fill: "rgba(15,118,110,0.12)" };
}

function getRoleHero(role: string): { eyebrow: string; title: string; desc: string; className: string } {
  if (role === "hider") {
    return {
      eyebrow: "Hider Console",
      title: "Cards, rewards, and answer flow",
      desc: "This view only surfaces the hider tools instead of leaving seeker controls disabled on the page.",
      className: "border-emerald-400/40 bg-emerald-50",
    };
  }
  if (role === "observer") {
    return {
      eyebrow: "Observer Console",
      title: "Neutral oversight across the room",
      desc: "Observer can inspect evidence, disputes, chat, and the shared map without stepping into role-only flows.",
      className: "border-slate-300/60 bg-slate-50",
    };
  }
  return {
    eyebrow: "Seeker Console",
    title: "Map-first investigation workspace",
    desc: "Search POIs, draw hypotheses, inspect legitimacy, and review evidence from one panel.",
    className: "border-cyan-400/40 bg-cyan-50",
  };
}

function computePlotBounds(points: Point[]): PlotBounds {
  if (points.length === 0) {
    return { minLat: 31.18, maxLat: 31.29, minLng: 121.42, maxLng: 121.53 };
  }
  let minLat = points[0].lat;
  let maxLat = points[0].lat;
  let minLng = points[0].lng;
  let maxLng = points[0].lng;
  for (const point of points) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLng = Math.max(maxLng, point.lng);
  }
  const latPad = Math.max(0.005, (maxLat - minLat) * 0.18);
  const lngPad = Math.max(0.005, (maxLng - minLng) * 0.18);
  return {
    minLat: minLat - latPad,
    maxLat: maxLat + latPad,
    minLng: minLng - lngPad,
    maxLng: maxLng + lngPad,
  };
}

function projectPoint(point: Point, bounds: PlotBounds, width: number, height: number): PlotPoint {
  const x = ((point.lng - bounds.minLng) / Math.max(1e-6, bounds.maxLng - bounds.minLng)) * width;
  const y = ((bounds.maxLat - point.lat) / Math.max(1e-6, bounds.maxLat - bounds.minLat)) * height;
  return { x, y };
}

function pixelsForMeters(radiusM: number, atPoint: Point, bounds: PlotBounds, width: number): number {
  const degreesLng = radiusM / (111320 * Math.max(0.15, Math.cos((atPoint.lat * Math.PI) / 180)));
  return (degreesLng / Math.max(1e-6, bounds.maxLng - bounds.minLng)) * width;
}

function defaultLayerForTool(tool: DrawTool): string {
  if (tool === "measure") {
    return "measurement";
  }
  if (tool === "line") {
    return "route_guess";
  }
  if (tool === "circle") {
    return "scan_zone";
  }
  return "possible_area";
}

function samePoint(a: Point | null, b: Point | null) {
  if (!a || !b) {
    return false;
  }
  return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;
}

function stripClosingPoint(points: Point[]) {
  if (points.length >= 2 && samePoint(points[0], points[points.length - 1])) {
    return points.slice(0, -1);
  }
  return points;
}

function appendDraftPoint(points: Point[], nextPoint: Point, drawTool: DrawTool) {
  if (drawTool === "circle") {
    return [nextPoint];
  }

  const openPoints = stripClosingPoint(points);
  if (drawTool === "polygon" && openPoints.length >= 2 && distanceMeters(openPoints[0], nextPoint) <= 120) {
    return [...openPoints, openPoints[0]];
  }

  return [...openPoints, nextPoint].slice(-40);
}

export function SeekingPanel({
  countdownText,
  projection,
  events,
  roomCode,
  playerId,
  busyAction,
  questionDefs,
  onRefreshProjection,
  onPerformRoundAction,
}: SeekingPanelProps) {
  const defs = questionDefs.length > 0 ? questionDefs : DEFAULT_QUESTION_DEFS;
  const players = useMemo(() => getProjectionPlayers(projection), [projection]);
  const me = useMemo(() => players.find((item) => item.id === playerId) ?? null, [playerId, players]);
  const meRole = String(me?.role ?? "observer").toLowerCase();
  const isSeeker = meRole === "seeker";
  const isHider = meRole === "hider";
  const hero = getRoleHero(meRole);
  const tabItems = isSeeker ? SEEKER_TABS : isHider ? HIDER_TABS : OBSERVER_TABS;
  const [activeTab, setActiveTab] = useState<TabKey>("map");
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
  const [dicePurpose, setDicePurpose] = useState("web_action");
  const [catchTargetId, setCatchTargetId] = useState("");
  const [rewardSelection, setRewardSelection] = useState<string[]>([]);
  const [rewardBusy, setRewardBusy] = useState(false);

  const [drawTool, setDrawTool] = useState<DrawTool>("polygon");
  const [annotationLayer, setAnnotationLayer] = useState("possible_area");
  const [annotationLabel, setAnnotationLabel] = useState("");
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [circleRadiusText, setCircleRadiusText] = useState("150");
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({});
  const [mapQuery, setMapQuery] = useState("");
  const [mapRadiusText, setMapRadiusText] = useState("1500");
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapBusy, setMapBusy] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<MapPlace | null>(null);
  const [placeResults, setPlaceResults] = useState<MapPlace[]>([]);
  const [selectedPlaceDetails, setSelectedPlaceDetails] = useState<Record<string, unknown> | null>(null);
  const [selectedPlaceLegitimacy, setSelectedPlaceLegitimacy] = useState<Record<string, unknown> | null>(null);
  const [selectedPlaceAdmin, setSelectedPlaceAdmin] = useState<Record<string, unknown> | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [uiNowMs, setUiNowMs] = useState(() => Date.now());
  const [seekElapsedSyncedAtMs, setSeekElapsedSyncedAtMs] = useState(() => Date.now());
  const [showPlayerMarkers, setShowPlayerMarkers] = useState(true);
  const [showSearchMarkers, setShowSearchMarkers] = useState(false);
  const [showSelectedPlaceMarker, setShowSelectedPlaceMarker] = useState(false);
  const [showBoundaryLayer, setShowBoundaryLayer] = useState(true);
  const [showHidingAreaLayer, setShowHidingAreaLayer] = useState(true);

  const [selectedEvidenceFile, setSelectedEvidenceFile] = useState<File | null>(null);
  const [evidenceType, setEvidenceType] = useState("photo");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [evidenceProgress, setEvidenceProgress] = useState(0);

  const [disputeType, setDisputeType] = useState<DisputeDraftType>("generic");
  const [disputeDescription, setDisputeDescription] = useState("");
  const [selectedDisputeEvidenceId, setSelectedDisputeEvidenceId] = useState("");
  const [disputeBusy, setDisputeBusy] = useState(false);
  const [voteBusyDisputeId, setVoteBusyDisputeId] = useState("");
  const [disputeError, setDisputeError] = useState<string | null>(null);

  const [chatInput, setChatInput] = useState("");
  const [composerMode, setComposerMode] = useState<"chat" | "clue">("chat");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const pendingQuestion = useMemo(() => getPendingQuestion(projection), [projection]);
  const pendingRewardChoice = useMemo(() => getPendingRewardChoice(projection), [projection]);
  const capabilities = useMemo(() => getProjectionCapabilities(projection), [projection]);
  const allowedActions = useMemo(() => getProjectionAllowedActions(projection), [projection]);
  const hand = useMemo(() => getProjectionHand(projection), [projection]);
  const evidenceItems = useMemo(() => getProjectionEvidence(projection), [projection]);
  const disputes = useMemo(() => getProjectionDisputes(projection), [projection]);
  const messages = useMemo(() => getProjectionMessages(projection), [projection]);
  const mapAnnotations = useMemo(
    () => (Array.isArray(projection?.mapAnnotations) ? projection.mapAnnotations.filter((item): item is ProjectionMapAnnotation => Boolean(item && typeof item === "object")) : []),
    [projection?.mapAnnotations],
  );
  const configBoundary = useMemo(() => extractConfigPolygonPoints(projection?.config?.borderPolygonGeoJSON), [projection?.config]);
  const configHidingArea = useMemo(() => extractConfigPolygonPoints(projection?.config?.hidingAreaGeoJSON), [projection?.config]);
  const hiderPlayers = useMemo(() => players.filter((item) => String(item.role ?? "").toLowerCase() === "hider"), [players]);
  const myActiveCurses = useMemo(() => Array.isArray(me?.activeCurses) ? me.activeCurses : [], [me?.activeCurses]);
  const pendingReward = pendingRewardChoice as PendingRewardChoiceProjection | null;
  const rewardCards = useMemo(
    () => Array.isArray(pendingReward?.candidateCards) ? pendingReward.candidateCards.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [],
    [pendingReward],
  );
  const rewardKeepCount = Math.max(1, Number(pendingReward?.keepCount ?? 1));
  const curseCards = useMemo(() => hand.filter((item) => String(item.type ?? "").toLowerCase() === "curse"), [hand]);
  const powerupCards = useMemo(() => hand.filter((item) => String(item.type ?? "").toLowerCase() === "powerup"), [hand]);
  const timeBonusCards = useMemo(() => hand.filter((item) => String(item.type ?? "").toLowerCase() === "time_bonus_fixed"), [hand]);
  const selectedPowerupCard = useMemo(
    () => powerupCards.find((item) => getCardId(item) === selectedPowerupCardId) ?? null,
    [powerupCards, selectedPowerupCardId],
  );
  const selectedPowerupKind = useMemo(
    () => (selectedPowerupCard ? getCardEffectKind(selectedPowerupCard) : ""),
    [selectedPowerupCard],
  );
  const selectedPowerupDiscardCount = Math.max(0, Number(asRecord(selectedPowerupCard?.effect).discardCount ?? 0));
  const discardableCards = useMemo(
    () => hand.filter((item) => getCardId(item) !== selectedPowerupCardId),
    [hand, selectedPowerupCardId],
  );
  const pendingQuestionId = typeof pendingQuestion?.id === "string" ? pendingQuestion.id : "";
  const latestAnsweredEvent = useMemo(() => [...events].reverse().find((item) => item.type === "question.answered") ?? null, [events]);
  const latestAnswerData = useMemo(() => asRecord(latestAnsweredEvent?.data), [latestAnsweredEvent?.data]);
  const sortedEvidence = useMemo(
    () => [...evidenceItems].sort((a, b) => Date.parse(String(b.createdAt ?? 0)) - Date.parse(String(a.createdAt ?? 0))),
    [evidenceItems],
  );
  const sortedDisputes = useMemo(
    () => [...disputes].sort((a, b) => Date.parse(String(b.createdAt ?? 0)) - Date.parse(String(a.createdAt ?? 0))),
    [disputes],
  );
  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => Date.parse(String(a.createdAt ?? 0)) - Date.parse(String(b.createdAt ?? 0))),
    [messages],
  );

  useEffect(() => {
    if (!tabItems.some((item) => item.key === activeTab)) {
      setActiveTab(tabItems[0]?.key ?? "map");
    }
  }, [activeTab, tabItems]);

  useEffect(() => {
    if (!defs.some((item) => item.key === askCategory)) {
      setAskCategory(defs[0]?.key ?? "matching");
    }
  }, [askCategory, defs]);

  useEffect(() => {
    if (!isHider && composerMode !== "chat") {
      setComposerMode("chat");
    }
  }, [composerMode, isHider]);

  useEffect(() => {
    if (!selectedCurseCardId && curseCards[0]?.id) {
      setSelectedCurseCardId(String(curseCards[0].id));
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
    if (!catchTargetId && hiderPlayers[0]?.id) {
      setCatchTargetId(hiderPlayers[0].id);
    }
  }, [catchTargetId, hiderPlayers]);

  useEffect(() => {
    if (!selectedDisputeEvidenceId && sortedEvidence[0]?.evidenceId) {
      setSelectedDisputeEvidenceId(String(sortedEvidence[0].evidenceId));
    }
  }, [selectedDisputeEvidenceId, sortedEvidence]);

  useEffect(() => {
    if (!pendingReward) {
      setRewardSelection([]);
      return;
    }
    const availableIds = rewardCards.map((item) => String(item.id ?? "")).filter((item) => item.length > 0);
    setRewardSelection((prev) => {
      const kept = prev.filter((item) => availableIds.includes(item));
      if (kept.length > 0) {
        return kept.slice(0, rewardKeepCount);
      }
      return availableIds.slice(0, rewardKeepCount);
    });
  }, [pendingReward, rewardCards, rewardKeepCount]);

  useEffect(() => {
    const timer = window.setInterval(() => setUiNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setSeekElapsedSyncedAtMs(Date.now());
  }, [projection?.phase, projection?.round?.seekDurationSecCurrent]);

  useEffect(() => {
    setAnnotationLayer(defaultLayerForTool(drawTool));
  }, [drawTool]);

  const drawCount = parsePositiveInt(drawCountText, 1, 1, 3);
  const diceSides = parsePositiveInt(diceSidesText, 6, 2, 100);
  const diceCount = parsePositiveInt(diceCountText, 1, 1, 5);
  const circleRadiusM = Math.max(0, Number(circleRadiusText) || 0);
  const draftEffectivePoints = useMemo(() => stripClosingPoint(draftPoints), [draftPoints]);
  const canDrawMap = capabilities.canDrawMap !== false && isSeeker;
  const circleOnlyMode = capabilities.mapToolMode === "circle_only";
  const clueAvailable = capabilities.canShareClue === true;
  const blockedQuestionCategories = Array.isArray(capabilities.blockedQuestionCategories)
    ? capabilities.blockedQuestionCategories.map((item) => String(item).toLowerCase())
    : [];

  const actionReasonByCapability = useCallback((action: RoundAction) => {
    const capabilityKey = ACTION_CAPABILITY_KEY[action];
    if (capabilityKey && capabilities[capabilityKey] === false) {
      return ACTION_REASON_FALLBACK[action];
    }
    return ACTION_REASON_FALLBACK[action];
  }, [capabilities]);

  const baseActionReason = useCallback((action: RoundAction): string | null => {
    if (busyAction) {
      return busyAction === action ? "Submitting..." : "Another action is in progress";
    }
    if (!allowedActions.includes(action)) {
      return actionReasonByCapability(action);
    }
    return null;
  }, [actionReasonByCapability, allowedActions, busyAction]);

  const askCooldownReason = (() => {
    const next = typeof capabilities.nextQuestionAt === "string" ? capabilities.nextQuestionAt : null;
    if (!next) {
      return null;
    }
    const nextAtMs = Date.parse(next);
    return Number.isFinite(nextAtMs) && nextAtMs > Date.now()
      ? `Question cooldown until ${new Date(nextAtMs).toLocaleTimeString()}`
      : null;
  })();

  const askReason =
    baseActionReason("ask") ??
    (!askCategory ? "Select a category" : null) ??
    (blockedQuestionCategories.includes(String(askCategory).toLowerCase()) ? `Category blocked by curse: ${askCategory}` : null) ??
    askCooldownReason;
  const answerReason =
    baseActionReason("answer") ??
    (!pendingQuestionId ? "No pending question" : null) ??
    (!answerValue.trim() ? "Answer text is required" : null);
  const drawReason = baseActionReason("drawCard");
  const castReason =
    (cardBusy ? "Submitting..." : null) ??
    baseActionReason("castCurse") ??
    (!selectedCurseCardId ? "Choose a curse card" : null);
  const powerupReason =
    (cardBusy ? "Submitting..." : null) ??
    baseActionReason("castCurse") ??
    (!selectedPowerupCardId ? "Choose a powerup card" : null) ??
    (selectedPowerupKind === "veto_pending_question" && !pendingQuestionId
      ? "No pending question to veto"
      : null) ??
    (selectedPowerupKind === "randomize_pending_question" && !pendingQuestionId
      ? "No pending question to randomize"
      : null) ??
    (selectedPowerupKind === "discard_draw" && selectedDiscardCardIds.length !== selectedPowerupDiscardCount
      ? `Select exactly ${selectedPowerupDiscardCount} discard card${selectedPowerupDiscardCount === 1 ? "" : "s"}`
      : null);
  const diceReason = baseActionReason("rollDice");
  const catchReason = baseActionReason("claimCatch") ?? (!catchTargetId ? "Choose a hider target" : null);
  const rewardReason =
    rewardBusy
      ? "Submitting..."
      : !pendingReward
        ? "No reward choice pending"
        : rewardSelection.length !== rewardKeepCount
          ? `Select exactly ${rewardKeepCount} card${rewardKeepCount > 1 ? "s" : ""}`
          : null;
  const drawSaveReason =
    !canDrawMap
      ? "Map drawing unavailable for this role"
      : busyAction
        ? "Another action is in progress"
        : circleOnlyMode && drawTool !== "circle"
          ? "Current curse restricts drawing to circles only"
          : drawTool === "circle"
            ? draftEffectivePoints.length < 1
              ? "Click canvas or add coordinates for the center"
              : circleRadiusM <= 0
                ? "Circle radius must be greater than zero"
                : null
            : drawTool === "polygon"
              ? draftEffectivePoints.length < 3
                ? "Polygon needs at least 3 points"
                : null
              : draftEffectivePoints.length < 2
                ? `${drawTool === "measure" ? "Measurement" : "Line"} needs at least 2 points`
                : null;

  const playerMarkers = useMemo(
    () => players
      .map((player) => {
        const point = pointFromUnknown(player.location);
        return point ? { id: player.id, name: player.name ?? player.id.slice(-6), role: String(player.role ?? "unknown"), point } : null;
      })
      .filter((item): item is { id: string; name: string; role: string; point: Point } => Boolean(item)),
    [players],
  );
  const allLayerNames = useMemo(() => [...new Set([...LAYER_OPTIONS, ...mapAnnotations.map((item) => String(item.layer ?? "possible_area"))])], [mapAnnotations]);

  useEffect(() => {
    setLayerVisibility((prev) => {
      const next = { ...prev };
      for (const layer of allLayerNames) {
        if (!Object.prototype.hasOwnProperty.call(next, layer)) {
          next[layer] = true;
        }
      }
      return next;
    });
  }, [allLayerNames]);

  const selectedPlacePoint = useMemo(() => (selectedPlace ? toPlaceCenter(selectedPlace) : null), [selectedPlace]);
  const allPlotPoints = useMemo(() => {
    const points: Point[] = [...configBoundary, ...configHidingArea, ...draftPoints];
    for (const marker of playerMarkers) {
      points.push(marker.point);
    }
    for (const place of placeResults) {
      const point = toPlaceCenter(place);
      if (point) {
        points.push(point);
      }
    }
    if (selectedPlacePoint) {
      points.push(selectedPlacePoint);
    }
    for (const annotation of mapAnnotations) {
      if (String(annotation.geometryType ?? "").toLowerCase() === "circle") {
        const circle = extractCircleGeometry(annotation);
        if (circle) {
          points.push(circle.center);
        }
      } else {
        points.push(...extractPolygonPoints(annotation));
      }
    }
    return points;
  }, [configBoundary, configHidingArea, draftPoints, mapAnnotations, placeResults, playerMarkers, selectedPlacePoint]);
  const plotWidth = 960;
  const plotHeight = 620;
  const plotBounds = useMemo(() => computePlotBounds(allPlotPoints), [allPlotPoints]);
  const draftDistance = useMemo(() => {
    if (draftEffectivePoints.length < 2) {
      return 0;
    }
    let total = 0;
    for (let index = 1; index < draftEffectivePoints.length; index += 1) {
      total += distanceMeters(draftEffectivePoints[index - 1], draftEffectivePoints[index]);
    }
    return total;
  }, [draftEffectivePoints]);
  const visibleAnnotations = useMemo(
    () => mapAnnotations.filter((item) => layerVisibility[String(item.layer ?? "possible_area")] !== false),
    [layerVisibility, mapAnnotations],
  );
  const mapSearchRadius = parsePositiveInt(mapRadiusText, 1500, 100, 10000);
  const distanceFromMeToSelectedPlace = useMemo(() => {
    const mine = pointFromUnknown(me?.location);
    return mine && selectedPlacePoint ? distanceMeters(mine, selectedPlacePoint) : null;
  }, [me?.location, selectedPlacePoint]);
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
  const heroTimerText = useMemo(() => {
    const phase = String(projection?.phase ?? "").toUpperCase();
    if (phase === "SEEK" || phase === "SEEKING" || phase === "CAUGHT" || phase === "ENDGAME" || phase === "END_GAME") {
      return `Seek Elapsed\n${formatCountdownMs(liveSeekElapsedSeconds * 1000)}`;
    }
    return countdownText ?? "Timer unavailable";
  }, [countdownText, liveSeekElapsedSeconds, projection?.phase]);

  const handleCanvasClick = useCallback((event: ReactMouseEvent<SVGSVGElement>) => {
    if (!canDrawMap) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const ratioX = (event.clientX - rect.left) / Math.max(1, rect.width);
    const ratioY = (event.clientY - rect.top) / Math.max(1, rect.height);
    const point: Point = {
      lng: plotBounds.minLng + ratioX * (plotBounds.maxLng - plotBounds.minLng),
      lat: plotBounds.maxLat - ratioY * (plotBounds.maxLat - plotBounds.minLat),
    };
    setDraftPoints((prev) => appendDraftPoint(prev, point, drawTool));
  }, [canDrawMap, drawTool, plotBounds.maxLat, plotBounds.maxLng, plotBounds.minLat, plotBounds.minLng]);

  const handleManualPointAdd = useCallback(() => {
    const lat = toFiniteNumber(manualLat);
    const lng = toFiniteNumber(manualLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setMapError("Latitude and longitude must be valid numbers");
      return;
    }
    setMapError(null);
    const point = { lat: Number(lat), lng: Number(lng) };
    setDraftPoints((prev) => appendDraftPoint(prev, point, drawTool));
    setManualLat("");
    setManualLng("");
  }, [drawTool, manualLat, manualLng]);

  const handleUseSelectedPlace = useCallback(() => {
    if (!selectedPlacePoint) {
      return;
    }
    setDraftPoints((prev) => appendDraftPoint(prev, selectedPlacePoint, drawTool));
  }, [drawTool, selectedPlacePoint]);

  const handleUseMyLocation = useCallback(() => {
    const point = pointFromUnknown(me?.location);
    if (!point) {
      return;
    }
    setDraftPoints((prev) => appendDraftPoint(prev, point, drawTool));
  }, [drawTool, me?.location]);

  const handleSaveDraft = useCallback(async () => {
    if (drawSaveReason) {
      return;
    }
    const effectiveDraftPoints = stripClosingPoint(draftPoints);
    let geometryType: "polygon" | "line" | "circle" = "polygon";
    let geometry: Record<string, unknown>;

    if (drawTool === "circle") {
      geometryType = "circle";
      geometry = {
        center: {
          lat: Number(effectiveDraftPoints[0].lat.toFixed(6)),
          lng: Number(effectiveDraftPoints[0].lng.toFixed(6)),
        },
        radiusM: Number(circleRadiusM.toFixed(1)),
      };
    } else if (drawTool === "line" || drawTool === "measure") {
      geometryType = "line";
      geometry = {
        points: effectiveDraftPoints.map((point) => ({
          lat: Number(point.lat.toFixed(6)),
          lng: Number(point.lng.toFixed(6)),
        })),
      };
    } else {
      geometryType = "polygon";
      geometry = {
        vertices: effectiveDraftPoints.map((point) => ({
          lat: Number(point.lat.toFixed(6)),
          lng: Number(point.lng.toFixed(6)),
        })),
      };
    }

    setMapBusy(true);
    setMapError(null);
    try {
      await addMapAnnotation(roomCode, {
        playerId,
        layer: annotationLayer.trim() || defaultLayerForTool(drawTool),
        geometryType,
        geometry,
        label: annotationLabel.trim() || `${defaultLayerForTool(drawTool)}_${Date.now()}`,
      });
      setDraftPoints([]);
      setAnnotationLabel("");
      await onRefreshProjection();
    } catch (caught) {
      setMapError(caught instanceof Error ? caught.message : "Failed to save map annotation");
    } finally {
      setMapBusy(false);
    }
  }, [annotationLabel, annotationLayer, circleRadiusM, drawSaveReason, drawTool, draftPoints, onRefreshProjection, playerId, roomCode]);

  const handlePlaceSearch = useCallback(async () => {
    setMapBusy(true);
    setMapError(null);
    try {
      const center = pointFromUnknown(me?.location);
      const response = await searchRoomPlaces(roomCode, {
        playerId,
        query: mapQuery.trim() || undefined,
        center,
        radiusM: mapSearchRadius,
      });
      setPlaceResults(Array.isArray(response.places.places) ? response.places.places : []);
      setShowSearchMarkers(true);
    } catch (caught) {
      setMapError(caught instanceof Error ? caught.message : "Failed to search POIs");
    } finally {
      setMapBusy(false);
    }
  }, [mapQuery, mapSearchRadius, me?.location, playerId, roomCode]);

  const handleInspectPlace = useCallback(async (place: MapPlace) => {
    setSelectedPlace(place);
    setMapBusy(true);
    setMapError(null);
    try {
      const detailsResponse = await fetchRoomPlaceDetails(roomCode, {
        playerId,
        placeId: String(place.placeId ?? ""),
      });
      setSelectedPlaceDetails(detailsResponse.place.details ?? null);
      setSelectedPlaceLegitimacy(detailsResponse.place.legitimacy ?? null);
      const center = toPlaceCenter(place);
      if (center) {
        const adminResponse = await reverseRoomAdminLevels(roomCode, {
          playerId,
          lat: center.lat,
          lng: center.lng,
        });
        setSelectedPlaceAdmin(adminResponse.admin.adminLevels ?? null);
      } else {
        setSelectedPlaceAdmin(null);
      }
      setShowSelectedPlaceMarker(true);
    } catch (caught) {
      setMapError(caught instanceof Error ? caught.message : "Failed to inspect place");
    } finally {
      setMapBusy(false);
    }
  }, [playerId, roomCode]);

  const handleReportLocation = useCallback(async () => {
    if (!navigator.geolocation) {
      setLocationError("Browser geolocation is unavailable");
      return;
    }
    setLocationBusy(true);
    setLocationError(null);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 10000,
        });
      });
      await updatePlayerLocation(roomCode, {
        playerId,
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      });
      await onRefreshProjection();
    } catch (caught) {
      setLocationError(caught instanceof Error ? caught.message : "Location update failed");
    } finally {
      setLocationBusy(false);
    }
  }, [onRefreshProjection, playerId, roomCode]);

  const handleAsk = useCallback(async () => {
    if (askReason) {
      return;
    }
    await onPerformRoundAction("ask", {
      playerId,
      category: askCategory,
      prompt: askPrompt.trim() || "Where are you now?",
    });
    setAskPrompt("");
  }, [askCategory, askPrompt, askReason, onPerformRoundAction, playerId]);

  const handleAnswer = useCallback(async () => {
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
  }, [answerReason, answerValue, onPerformRoundAction, pendingQuestionId, playerId]);

  const handleDrawCard = useCallback(async () => {
    if (drawReason) {
      return;
    }
    await onPerformRoundAction("drawCard", {
      playerId,
      count: drawCount,
    });
  }, [drawCount, drawReason, onPerformRoundAction, playerId]);

  const handleCastCurse = useCallback(async () => {
    if (castReason) {
      return;
    }
    setCardError(null);
    await onPerformRoundAction("castCurse", {
      playerId,
      cardId: selectedCurseCardId,
    });
  }, [castReason, onPerformRoundAction, playerId, selectedCurseCardId]);

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
      await castPlayerCard(roomCode, {
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
    onRefreshProjection,
    playerId,
    powerupReason,
    roomCode,
    selectedDiscardCardIds,
    selectedPowerupCardId,
    selectedPowerupKind,
  ]);

  const handleRollDice = useCallback(async () => {
    if (diceReason) {
      return;
    }
    await onPerformRoundAction("rollDice", {
      playerId,
      sides: diceSides,
      count: diceCount,
      purpose: dicePurpose.trim() || "web_action",
    });
  }, [diceCount, dicePurpose, diceReason, diceSides, onPerformRoundAction, playerId]);

  const handleClaimCatch = useCallback(async () => {
    if (catchReason) {
      return;
    }
    await onPerformRoundAction("claimCatch", {
      playerId,
      targetPlayerId: catchTargetId,
      method: "distance",
      visualConfirmed: true,
    });
  }, [catchReason, catchTargetId, onPerformRoundAction, playerId]);

  const toggleRewardSelection = useCallback((cardId: string) => {
    setRewardSelection((prev) => {
      if (prev.includes(cardId)) {
        return prev.filter((item) => item !== cardId);
      }
      if (prev.length >= rewardKeepCount) {
        return [...prev.slice(1), cardId];
      }
      return [...prev, cardId];
    });
  }, [rewardKeepCount]);

  const handleSubmitRewardChoice = useCallback(async () => {
    if (rewardReason) {
      return;
    }
    setRewardBusy(true);
    try {
      await chooseRewardCards(roomCode, {
        playerId,
        cardIds: rewardSelection,
      });
      await onRefreshProjection();
      setActiveTab("cards");
    } finally {
      setRewardBusy(false);
    }
  }, [onRefreshProjection, playerId, rewardReason, rewardSelection, roomCode]);

  const handleEvidenceFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    setSelectedEvidenceFile(nextFile);
    setEvidenceError(null);
  }, []);

  const handleUploadEvidence = useCallback(async () => {
    if (!selectedEvidenceFile) {
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
      };
      const init = await initEvidenceUpload(roomCode, {
        playerId,
        type: evidenceType,
        mimeType: selectedEvidenceFile.type || "application/octet-stream",
        metadata,
      });
      setEvidenceProgress(0.2);
      const upload = await uploadEvidenceBinary(init.upload.uploadUrl, {
        file: selectedEvidenceFile,
      });
      setEvidenceProgress(0.75);
      await completeEvidenceUpload(roomCode, {
        playerId,
        evidenceId: init.upload.evidenceId,
        storageKey: upload.upload.storageKey,
        fileName: upload.upload.fileName,
        mimeType: upload.upload.mimeType,
        sizeBytes: upload.upload.sizeBytes,
        viewUrl: upload.upload.viewUrl,
        metadata,
      });
      setEvidenceProgress(1);
      setSelectedEvidenceFile(null);
      setEvidenceNote("");
      await onRefreshProjection();
    } catch (caught) {
      setEvidenceError(caught instanceof Error ? caught.message : "Evidence upload failed");
    } finally {
      window.setTimeout(() => setEvidenceProgress(0), 450);
      setEvidenceBusy(false);
    }
  }, [evidenceNote, evidenceType, onRefreshProjection, playerId, roomCode, selectedEvidenceFile, selectedPlace]);

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
        payload.evidenceId = selectedDisputeEvidenceId || null;
      }
      await createDispute(roomCode, {
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
  }, [disputeDescription, disputeType, onRefreshProjection, playerId, roomCode, selectedDisputeEvidenceId, selectedPlace]);

  const handleVoteDispute = useCallback(async (disputeId: string, vote: "accept" | "reject") => {
    setVoteBusyDisputeId(disputeId);
    setDisputeError(null);
    try {
      await voteDispute(roomCode, disputeId, {
        playerId,
        vote,
        resumeAfterResolve: true,
      });
      await onRefreshProjection();
    } catch (caught) {
      setDisputeError(caught instanceof Error ? caught.message : "Vote failed");
    } finally {
      setVoteBusyDisputeId("");
    }
  }, [onRefreshProjection, playerId, roomCode]);

  const handleSendChat = useCallback(async () => {
    if (!chatInput.trim()) {
      return;
    }
    setChatBusy(true);
    setChatError(null);
    try {
      if (composerMode === "clue") {
        await sendClue(roomCode, {
          playerId,
          text: chatInput.trim(),
        });
      } else {
        await sendChatMessage(roomCode, {
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
  }, [chatInput, composerMode, onRefreshProjection, playerId, roomCode]);

  const handleResolveCatch = useCallback(async (result: "success" | "failed") => {
    if (!pendingCatchClaimId) {
      return;
    }
    await resolveCatch(roomCode, pendingCatchClaimId, {
      playerId,
      result,
    });
    await onRefreshProjection();
  }, [onRefreshProjection, pendingCatchClaimId, playerId, roomCode]);
  const disputeOpenReason =
    disputeBusy
      ? "Submitting..."
      : !pendingCatchClaimId
        ? "Open disputes only during catch review"
        : !disputeDescription.trim()
          ? "Describe what needs review"
          : disputeType === "place_legitimacy" && !selectedPlace?.placeId
            ? "Inspect a POI before opening a place dispute"
            : disputeType === "evidence_review" && !selectedDisputeEvidenceId
              ? "Select evidence before opening an evidence review"
              : null;
  const chatReason =
    chatBusy
      ? "Sending..."
      : composerMode === "clue" && (!isHider || !clueAvailable)
        ? "Clue is not available right now"
        : !chatInput.trim()
          ? "Type a message first"
          : null;

  const renderMapTab = () => (
    <div className="rounded-2xl border border-black/10 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Map Workspace</p>
          <p className="mt-1 text-sm text-black/65">
            Auto provider {asText(projection?.mapProvider, "GOOGLE")} | Transit {asText(projection?.transitPackId, "none")}
          </p>
        </div>
        <div className="rounded-lg bg-black/5 px-3 py-2 text-xs text-black/65">
          Boundary {configBoundary.length} pts | Hide area {configHidingArea.length} pts | Layers {allLayerNames.length}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-black/10 bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)]">
        <svg
          viewBox={`0 0 ${plotWidth} ${plotHeight}`}
          className="aspect-[1.55/1] w-full cursor-crosshair"
          onClick={handleCanvasClick}
        >
          {[0.2, 0.4, 0.6, 0.8].map((ratio) => (
            <g key={ratio}>
              <line x1={plotWidth * ratio} y1={0} x2={plotWidth * ratio} y2={plotHeight} stroke="rgba(15,23,42,0.08)" strokeDasharray="8 8" />
              <line x1={0} y1={plotHeight * ratio} x2={plotWidth} y2={plotHeight * ratio} stroke="rgba(15,23,42,0.08)" strokeDasharray="8 8" />
            </g>
          ))}

          {showBoundaryLayer && configBoundary.length >= 3 ? (
            <polygon
              points={configBoundary.map((point) => {
                const plotted = projectPoint(point, plotBounds, plotWidth, plotHeight);
                return `${plotted.x},${plotted.y}`;
              }).join(" ")}
              fill="rgba(15,118,110,0.10)"
              stroke="#0f766e"
              strokeWidth={4}
              strokeDasharray="14 10"
            />
          ) : null}

          {showHidingAreaLayer && configHidingArea.length >= 3 ? (
            <polygon
              points={configHidingArea.map((point) => {
                const plotted = projectPoint(point, plotBounds, plotWidth, plotHeight);
                return `${plotted.x},${plotted.y}`;
              }).join(" ")}
              fill="rgba(5,150,105,0.16)"
              stroke="#059669"
              strokeWidth={3}
              strokeDasharray="8 8"
            />
          ) : null}

          {visibleAnnotations.map((annotation) => {
            const layer = String(annotation.layer ?? defaultLayerForTool(drawTool));
            const colors = layerColors(layer);
            const geometryType = String(annotation.geometryType ?? "polygon").toLowerCase();
            if (geometryType === "circle") {
              const circle = extractCircleGeometry(annotation);
              if (!circle) {
                return null;
              }
              const center = projectPoint(circle.center, plotBounds, plotWidth, plotHeight);
              const radius = pixelsForMeters(circle.radiusM, circle.center, plotBounds, plotWidth);
              return (
                <g key={String(annotation.id ?? annotation.annotationId ?? `${layer}-circle`)}>
                  <circle cx={center.x} cy={center.y} r={Math.max(8, radius)} fill={colors.fill} stroke={colors.stroke} strokeWidth={3} />
                  <text x={center.x + 12} y={center.y - 12} fontSize="20" fill={colors.stroke}>{asText(annotation.label)}</text>
                </g>
              );
            }

            const points = extractPolygonPoints(annotation);
            const plotted = points.map((point) => projectPoint(point, plotBounds, plotWidth, plotHeight));
            if (plotted.length < 2) {
              return null;
            }

            if (geometryType === "line") {
              return (
                <g key={String(annotation.id ?? annotation.annotationId ?? `${layer}-line`)}>
                  <polyline
                    points={plotted.map((point) => `${point.x},${point.y}`).join(" ")}
                    fill="none"
                    stroke={colors.stroke}
                    strokeWidth={5}
                    strokeDasharray={layer === "measurement" ? "12 10" : undefined}
                  />
                  <text x={plotted[plotted.length - 1].x + 10} y={plotted[plotted.length - 1].y - 10} fontSize="20" fill={colors.stroke}>
                    {asText(annotation.label)}
                  </text>
                </g>
              );
            }

            return (
              <g key={String(annotation.id ?? annotation.annotationId ?? `${layer}-polygon`)}>
                <polygon
                  points={plotted.map((point) => `${point.x},${point.y}`).join(" ")}
                  fill={colors.fill}
                  stroke={colors.stroke}
                  strokeWidth={4}
                />
                <text x={plotted[0].x + 10} y={plotted[0].y - 10} fontSize="20" fill={colors.stroke}>
                  {asText(annotation.label)}
                </text>
              </g>
            );
          })}

          {drawTool === "polygon" && draftPoints.length >= 3 ? (
            <polygon
              points={draftPoints.map((point) => {
                const plotted = projectPoint(point, plotBounds, plotWidth, plotHeight);
                return `${plotted.x},${plotted.y}`;
              }).join(" ")}
              fill="rgba(249,115,22,0.14)"
              stroke="#f97316"
              strokeWidth={4}
              strokeDasharray="12 6"
            />
          ) : draftPoints.length >= 2 && drawTool !== "circle" ? (
            <polyline
              points={draftPoints.map((point) => {
                const plotted = projectPoint(point, plotBounds, plotWidth, plotHeight);
                return `${plotted.x},${plotted.y}`;
              }).join(" ")}
              fill="none"
              stroke="#f97316"
              strokeWidth={4}
              strokeDasharray={drawTool === "measure" ? "10 10" : "12 6"}
            />
          ) : null}

          {drawTool === "circle" && draftPoints[0] ? (() => {
            const center = projectPoint(draftPoints[0], plotBounds, plotWidth, plotHeight);
            const radius = pixelsForMeters(Math.max(circleRadiusM, 10), draftPoints[0], plotBounds, plotWidth);
            return <circle cx={center.x} cy={center.y} r={Math.max(8, radius)} fill="rgba(249,115,22,0.12)" stroke="#f97316" strokeWidth={4} />;
          })() : null}

          {draftPoints.map((point, index) => {
            const plotted = projectPoint(point, plotBounds, plotWidth, plotHeight);
            return (
              <g key={`draft-${index}`}>
                <circle cx={plotted.x} cy={plotted.y} r={8} fill="#f97316" />
                <text x={plotted.x + 10} y={plotted.y - 10} fontSize="18" fill="#9a3412">{index + 1}</text>
              </g>
            );
          })}

          {showPlayerMarkers ? playerMarkers.map((marker) => {
            const plotted = projectPoint(marker.point, plotBounds, plotWidth, plotHeight);
            const fill = marker.role === "hider" ? "#059669" : marker.role === "seeker" ? "#1d4ed8" : "#334155";
            return (
              <g key={marker.id}>
                <circle cx={plotted.x} cy={plotted.y} r={11} fill={fill} />
                <text x={plotted.x + 14} y={plotted.y - 12} fontSize="18" fill="#0f172a">
                  {marker.name} ({marker.role})
                </text>
              </g>
            );
          }) : null}

          {showSearchMarkers ? placeResults.map((place, index) => {
            const placePoint = toPlaceCenter(place);
            if (!placePoint) {
              return null;
            }
            const plotted = projectPoint(placePoint, plotBounds, plotWidth, plotHeight);
            const isSelected = selectedPlace?.placeId && selectedPlace.placeId === place.placeId;
            return (
              <g key={`poi-${String(place.placeId ?? index)}`}>
                <circle cx={plotted.x} cy={plotted.y} r={isSelected ? 8 : 6} fill={isSelected ? "#7c3aed" : "#94a3b8"} />
              </g>
            );
          }) : null}

          {showSelectedPlaceMarker && selectedPlacePoint ? (() => {
            const plotted = projectPoint(selectedPlacePoint, plotBounds, plotWidth, plotHeight);
            return (
              <g>
                <rect x={plotted.x - 8} y={plotted.y - 8} width={16} height={16} fill="#7c3aed" transform={`rotate(45 ${plotted.x} ${plotted.y})`} />
                <text x={plotted.x + 14} y={plotted.y + 4} fontSize="20" fill="#5b21b6">
                  {asText(selectedPlace?.name, "Selected POI")}
                </text>
              </g>
            );
          })() : null}
        </svg>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="grid gap-4">
          <div className="rounded-xl border border-black/10 bg-surface p-4">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Draw Tools</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {DRAW_TOOLS.map((tool) => (
                <button
                  key={tool.key}
                  type="button"
                  disabled={circleOnlyMode && tool.key !== "circle"}
                  onClick={() => setDrawTool(tool.key)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
                    drawTool === tool.key ? "border-accent bg-accent/10 text-accent" : "border-black/15 bg-white text-black/70"
                  } disabled:opacity-40`}
                >
                  {tool.label}
                </button>
              ))}
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <input value={manualLat} onChange={(event) => setManualLat(event.target.value)} placeholder="Latitude" className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring" />
              <input value={manualLng} onChange={(event) => setManualLng(event.target.value)} placeholder="Longitude" className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring" />
              <button type="button" onClick={handleManualPointAdd} className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white transition hover:brightness-95">
                Add Point
              </button>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr]">
              <select value={annotationLayer} onChange={(event) => setAnnotationLayer(event.target.value)} className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring">
                {allLayerNames.map((layer) => (
                  <option key={layer} value={layer}>{layer}</option>
                ))}
              </select>
              <input value={annotationLabel} onChange={(event) => setAnnotationLabel(event.target.value)} placeholder="Annotation label" className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring" />
            </div>

            {drawTool === "circle" ? (
              <input value={circleRadiusText} onChange={(event) => setCircleRadiusText(event.target.value)} placeholder="Circle radius in meters" className="mt-3 w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring" />
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={handleUseMyLocation} className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm font-semibold">Use My Location</button>
              <button type="button" onClick={handleUseSelectedPlace} className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm font-semibold">Use Selected POI</button>
              <button type="button" onClick={() => setDraftPoints((prev) => prev.slice(0, -1))} className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm font-semibold">Undo</button>
              <button type="button" onClick={() => setDraftPoints([])} className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm font-semibold">Clear Draft</button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" disabled={Boolean(drawSaveReason) || mapBusy} onClick={() => void handleSaveDraft()} className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-45">
                {mapBusy ? "Saving..." : "Save Annotation"}
              </button>
              <span className="text-sm text-black/65">
                Draft {draftEffectivePoints.length} point{draftEffectivePoints.length === 1 ? "" : "s"} {drawTool === "measure" || drawTool === "line" ? `| ${formatDistance(draftDistance)}` : ""}
              </span>
            </div>
            {drawSaveReason ? <p className="mt-2 text-sm text-signal">{drawSaveReason}</p> : null}
            <p className="mt-2 text-xs text-black/55">
              Tip: blank POI search returns nearby demo places. Try `Temple`, `Square`, `Park`, `Station`, or `Cafe`. For polygons, clicking near the first point will snap the shape closed.
            </p>
          </div>

          <div className="rounded-xl border border-black/10 bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <input value={mapQuery} onChange={(event) => setMapQuery(event.target.value)} placeholder="Search POIs" className="min-w-[180px] flex-1 rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring" />
              <input value={mapRadiusText} onChange={(event) => setMapRadiusText(event.target.value)} className="w-28 rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring" />
              <button type="button" onClick={() => void handlePlaceSearch()} className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white transition hover:brightness-95">
                {mapBusy ? "Working..." : "Search"}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <label className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm">
                <input type="checkbox" checked={showBoundaryLayer} onChange={(event) => setShowBoundaryLayer(event.target.checked)} />
                Boundary
              </label>
              <label className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm">
                <input type="checkbox" checked={showHidingAreaLayer} onChange={(event) => setShowHidingAreaLayer(event.target.checked)} />
                Hide Area
              </label>
              <label className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm">
                <input type="checkbox" checked={showPlayerMarkers} onChange={(event) => setShowPlayerMarkers(event.target.checked)} />
                Players
              </label>
              <label className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm">
                <input type="checkbox" checked={showSearchMarkers} onChange={(event) => setShowSearchMarkers(event.target.checked)} />
                Search Results
              </label>
              <label className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm">
                <input type="checkbox" checked={showSelectedPlaceMarker} onChange={(event) => setShowSelectedPlaceMarker(event.target.checked)} />
                Selected POI
              </label>
              {allLayerNames.map((layer) => (
                <label key={layer} className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm">
                  <input type="checkbox" checked={layerVisibility[layer] !== false} onChange={(event) => setLayerVisibility((prev) => ({ ...prev, [layer]: event.target.checked }))} />
                  {layer}
                </label>
              ))}
            </div>
            <div className="mt-3 grid gap-2">
              {placeResults.length === 0 ? (
                <p className="text-sm text-black/55">No search results yet.</p>
              ) : (
                placeResults.slice(0, 8).map((place, index) => (
                  <button
                    key={`${place.placeId ?? place.name ?? index}`}
                    type="button"
                    onClick={() => void handleInspectPlace(place)}
                    className={`rounded-xl border px-3 py-3 text-left text-sm transition ${
                      selectedPlace?.placeId === place.placeId ? "border-accent bg-accent/5" : "border-black/10 bg-white hover:border-accent/40"
                    }`}
                  >
                    <p className="font-semibold text-black/85">{asText(place.name, "Unnamed place")}</p>
                    <p className="mt-1 text-xs text-black/55">{asText(place.placeId)} | {formatDistance(toFiniteNumber(place.distanceMeters))}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-surface p-4 text-sm">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Selected POI</p>
          {selectedPlace ? (
            <div className="mt-3 space-y-3">
              <div className="rounded-lg border border-black/10 bg-white p-3">
                <p className="font-semibold">{asText(selectedPlace.name, "Unnamed place")}</p>
                <p className="mt-1 text-xs text-black/55">{asText(selectedPlace.placeId)} | {formatDistance(distanceFromMeToSelectedPlace)}</p>
                <button type="button" onClick={() => setSelectedPlace(null)} className="mt-3 rounded-lg border border-black/15 bg-surface px-3 py-1.5 text-xs font-semibold text-black/75">
                  Clear Selected POI
                </button>
              </div>
              <div className="rounded-lg border border-black/10 bg-white p-3">
                <p className="font-semibold text-black/80">Legitimacy</p>
                <p className="mt-1 text-xs text-black/60">{shortJson(selectedPlaceLegitimacy)}</p>
              </div>
              <div className="rounded-lg border border-black/10 bg-white p-3">
                <p className="font-semibold text-black/80">Admin Levels</p>
                <p className="mt-1 text-xs text-black/60">{shortJson(selectedPlaceAdmin)}</p>
              </div>
              <div className="rounded-lg border border-black/10 bg-white p-3">
                <p className="font-semibold text-black/80">Place Details</p>
                <p className="mt-1 text-xs text-black/60">{shortJson(selectedPlaceDetails)}</p>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-black/55">Inspect a POI to view place details, legitimacy, and admin levels.</p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-black/65">
            <button type="button" onClick={() => void handleReportLocation()} className="rounded-lg border border-black/20 bg-white px-3 py-2 font-semibold">
              {locationBusy ? "Reporting..." : "Report Browser Location"}
            </button>
            {locationError ? <span className="text-signal">{locationError}</span> : null}
            {mapError ? <span className="text-signal">{mapError}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );

  const renderQaTab = () => (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-black/10 bg-surface p-4">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">{isHider ? "Pending Question" : "Ask A Question"}</p>
        {isSeeker ? (
          <div className="mt-3 grid gap-3">
            <select value={askCategory} onChange={(event) => setAskCategory(event.target.value)} className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring">
              {defs.map((item) => (
                <option key={item.key} value={item.key}>{item.label ?? item.key}</option>
              ))}
            </select>
            <textarea value={askPrompt} onChange={(event) => setAskPrompt(event.target.value)} rows={5} placeholder="Where are you now?" className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring" />
            <button type="button" disabled={Boolean(askReason)} onClick={() => void handleAsk()} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-45">
              Submit Question
            </button>
            {askReason ? <p className="text-sm text-signal">{askReason}</p> : null}
          </div>
        ) : (
          <div className="mt-3 grid gap-3">
            <div className="rounded-lg border border-black/10 bg-white p-3 text-sm">
              {pendingQuestionId ? (
                <>
                  <p className="font-semibold">{asText(pendingQuestion?.category, "Pending question")}</p>
                  <p className="mt-1 text-black/75">{asText(pendingQuestion?.prompt, "No question is waiting for answer.")}</p>
                  <p className="mt-2 text-xs text-black/55">Due: {formatDateTime(pendingQuestion?.dueAt)}</p>
                </>
              ) : (
                <>
                  <p className="font-semibold">Latest answer state</p>
                  <p className="mt-1 text-black/75">{asText(latestAnswerData.value, "No question is waiting for answer.")}</p>
                  <p className="mt-2 text-xs text-black/55">Answered: {formatDateTime(latestAnswerData.answeredAt)}</p>
                </>
              )}
            </div>
            {pendingQuestionId ? (
              <>
                <textarea value={answerValue} onChange={(event) => setAnswerValue(event.target.value)} rows={5} placeholder="Answer text" className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring" />
                <button type="button" disabled={Boolean(answerReason)} onClick={() => void handleAnswer()} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-45">
                  Submit Answer
                </button>
                {answerReason ? <p className="text-sm text-signal">{answerReason}</p> : null}
              </>
            ) : (
              <p className="text-sm text-black/55">Answer input hides once the pending question is resolved.</p>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-black/10 bg-surface p-4">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Latest Answer State</p>
        {latestAnsweredEvent ? (
          <div className="mt-3 rounded-xl border border-black/10 bg-white p-4 text-sm">
            <p className="font-semibold text-black/80">{asText(latestAnswerData.questionId, "question")}</p>
            <p className="mt-2 text-black/75">{asText(latestAnswerData.value, shortJson(latestAnswerData.answer))}</p>
            <p className="mt-2 text-xs text-black/55">Answered at {formatDateTime(latestAnsweredEvent.ts)}</p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-black/55">No answered question has been observed in this round yet.</p>
        )}
      </section>
    </div>
  );

  const renderCardsTab = () => (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <section className="rounded-xl border border-black/10 bg-surface p-4">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Draw + Play</p>
        <div className="mt-3 grid gap-3">
          <input value={drawCountText} onChange={(event) => setDrawCountText(event.target.value)} className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring" />
          <button type="button" disabled={Boolean(drawReason)} onClick={() => void handleDrawCard()} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-45">
            Draw Card
          </button>
          {drawReason ? <p className="text-sm text-signal">{drawReason}</p> : null}

          <div className="rounded-xl border border-black/10 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-black/45">Curse</p>
            {curseCards.length === 0 ? (
              <p className="mt-2 text-sm text-black/55">No curse cards in hand.</p>
            ) : (
              <div className="mt-3 grid gap-3">
                <select value={selectedCurseCardId} onChange={(event) => setSelectedCurseCardId(event.target.value)} className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring">
                  <option value="">Select curse card</option>
                  {curseCards.map((card) => (
                    <option key={getCardId(card)} value={getCardId(card)}>
                      {getCardTitle(card)}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={Boolean(castReason)} onClick={() => void handleCastCurse()} className="rounded-lg border border-black/20 bg-white px-4 py-2 text-sm font-semibold transition hover:bg-black hover:text-white disabled:opacity-45">
                  Cast To All Seekers
                </button>
                <p className="text-xs text-black/55">Curse cards now apply to every active seeker and no longer require a single target.</p>
                {castReason ? <p className="text-sm text-signal">{castReason}</p> : null}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-black/10 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-black/45">Powerups</p>
            {powerupCards.length === 0 ? (
              <p className="mt-2 text-sm text-black/55">No active powerup cards in hand.</p>
            ) : (
              <div className="mt-3 grid gap-3">
                <select value={selectedPowerupCardId} onChange={(event) => setSelectedPowerupCardId(event.target.value)} className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring">
                  <option value="">Select powerup</option>
                  {powerupCards.map((card) => (
                    <option key={getCardId(card)} value={getCardId(card)}>
                      {getCardTitle(card)}
                    </option>
                  ))}
                </select>
                {selectedPowerupCard ? (
                  <div className="rounded-lg border border-black/10 bg-surface px-3 py-3 text-sm">
                    <p className="font-semibold text-black/80">{describePowerup(selectedPowerupCard)}</p>
                    {selectedPowerupKind === "discard_draw" ? (
                      <>
                        <p className="mt-2 text-xs text-black/55">
                          Select {selectedPowerupDiscardCount} discard card{selectedPowerupDiscardCount === 1 ? "" : "s"} from the rest of your hand.
                        </p>
                        <div className="mt-3 grid gap-2">
                          {discardableCards.length === 0 ? (
                            <p className="text-xs text-black/55">No other cards are available to discard.</p>
                          ) : (
                            discardableCards.map((card) => {
                              const cardId = getCardId(card);
                              const selected = selectedDiscardCardIds.includes(cardId);
                              return (
                                <button
                                  key={cardId}
                                  type="button"
                                  onClick={() => toggleDiscardCard(cardId)}
                                  className={`rounded-lg border px-3 py-2 text-left text-sm transition ${selected ? "border-accent bg-accent/10 text-accent" : "border-black/10 bg-white text-black/75 hover:border-black/25"}`}
                                >
                                  <span className="block font-semibold">{getCardTitle(card)}</span>
                                  <span className="block text-xs opacity-70">{shortJson(card.effect)}</span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
                <button type="button" disabled={Boolean(powerupReason)} onClick={() => void handleUsePowerup()} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-45">
                  Use Powerup
                </button>
                {powerupReason ? <p className="text-sm text-signal">{powerupReason}</p> : null}
              </div>
            )}
          </div>

          {cardError ? <p className="text-sm text-signal">{cardError}</p> : null}
        </div>
      </section>

      <section className="rounded-xl border border-black/10 bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Hand</p>
          <span className="rounded-full bg-black/5 px-3 py-1 text-xs text-black/60">{hand.length} / {String(capabilities.maxHandLimit ?? "-")}</span>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {hand.length === 0 ? (
            <p className="text-sm text-black/55">Hand is empty.</p>
          ) : (
            hand.map((card, index) => (
              <article key={String(card.id ?? index)} className="rounded-xl border border-black/10 bg-white p-3 text-sm">
                <p className="font-semibold text-black/85">{asText(card.name, asText(card.templateId, "card"))}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.12em] text-black/45">{asText(card.type)}</p>
                <p className="mt-2 text-xs text-black/60">{shortJson(card.effect)}</p>
              </article>
            ))
          )}
        </div>
        {timeBonusCards.length > 0 ? (
          <div className="mt-4 rounded-xl border border-black/10 bg-white p-3 text-sm text-black/65">
            <p className="font-semibold text-black/80">Passive score cards</p>
            <p className="mt-1">Time bonus cards stay in hand and score automatically during catch/summary. They are not manually cast.</p>
          </div>
        ) : null}
      </section>
    </div>
  );

  const renderRewardsTab = () => (
    <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
      <section className="rounded-xl border border-black/10 bg-surface p-4">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Pending Reward</p>
        {pendingReward ? (
          <div className="mt-3 rounded-xl border border-black/10 bg-white p-4 text-sm">
            <p>Question {asText(pendingReward.questionId)}</p>
            <p className="mt-1 text-black/65">Choose exactly {rewardKeepCount} card(s) to keep.</p>
            <button type="button" disabled={Boolean(rewardReason)} onClick={() => void handleSubmitRewardChoice()} className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-45">
              {rewardBusy ? "Submitting..." : "Confirm Reward Choice"}
            </button>
            {rewardReason ? <p className="mt-2 text-sm text-signal">{rewardReason}</p> : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-black/55">No reward selection is pending.</p>
        )}
      </section>

      <section className="rounded-xl border border-black/10 bg-surface p-4">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Candidate Cards</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {rewardCards.length === 0 ? (
            <p className="text-sm text-black/55">Reward cards will appear here after a successful answer reward.</p>
          ) : (
            rewardCards.map((card) => {
              const cardId = String(card.id ?? "");
              const selected = rewardSelection.includes(cardId);
              return (
                <button key={cardId} type="button" onClick={() => toggleRewardSelection(cardId)} className={`rounded-xl border p-4 text-left text-sm transition ${selected ? "border-accent bg-accent/10" : "border-black/10 bg-white hover:border-accent/40"}`}>
                  <p className="font-semibold text-black/85">{asText(card.name, asText(card.templateId, cardId))}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.12em] text-black/45">{asText(card.type)}</p>
                  <p className="mt-2 text-xs text-black/60">{shortJson(card.effect)}</p>
                </button>
              );
            })
          )}
        </div>
      </section>
    </div>
  );

  const renderToolsTab = () => (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="rounded-xl border border-black/10 bg-surface p-4">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Dice</p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <input value={diceSidesText} onChange={(event) => setDiceSidesText(event.target.value)} placeholder="Sides" className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring" />
          <input value={diceCountText} onChange={(event) => setDiceCountText(event.target.value)} placeholder="Count" className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring" />
          <input value={dicePurpose} onChange={(event) => setDicePurpose(event.target.value)} placeholder="Purpose" className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring" />
        </div>
        <button type="button" disabled={Boolean(diceReason)} onClick={() => void handleRollDice()} className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-45">
          Roll Dice
        </button>
        {diceReason ? <p className="mt-2 text-sm text-signal">{diceReason}</p> : null}
      </section>

      <section className="rounded-xl border border-black/10 bg-surface p-4 text-sm">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Map Notes</p>
        <div className="mt-3 space-y-3 text-black/70">
          <p>
            POI provider is auto-resolved as <span className="font-semibold text-black/85">{asText(projection?.mapProvider, "auto")}</span>. In the current web/iPhone test build, the visible base map is still the local plotting surface or native map, so provider affects POI and admin-level lookup rather than the visual map skin.
          </p>
          <p>
            Transit pack <span className="font-semibold text-black/85">{asText(projection?.transitPackId, "default")}</span> is used for nearest-station and route-context checks. It is not a separate map skin.
          </p>
          <p>
            Photos are now intended for question / curse / catch evidence. Formal disputes should be opened from the Catch tab, not from the general tools area.
          </p>
        </div>
      </section>
    </div>
  );

  const renderCommsTab = () => (
    <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
      <section className="rounded-xl border border-black/10 bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Room Comms</p>
            <p className="mt-1 text-sm text-black/60">One shared composer for chat, clue, and photo evidence.</p>
          </div>
          {isHider ? (
            <div className="flex gap-2">
              {(["chat", "clue"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setComposerMode(mode)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${composerMode === mode ? "border-black bg-black text-white" : "border-black/15 bg-white text-black/60"}`}
                >
                  {mode === "chat" ? "Chat" : "Clue"}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <textarea
          value={chatInput}
          onChange={(event) => setChatInput(event.target.value)}
          rows={4}
          placeholder={composerMode === "clue" ? "Share a clue to every seeker" : "Type a room message"}
          className="mt-3 rounded-2xl border border-black/15 bg-white px-4 py-3 text-sm outline-none ring-accent/40 focus:ring"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={evidenceType} onChange={(event) => setEvidenceType(event.target.value)} className="rounded-full border border-black/15 bg-white px-3 py-2 text-xs font-semibold outline-none ring-accent/40 focus:ring">
            <option value="photo">photo</option>
            <option value="catch">catch</option>
            <option value="curse">curse</option>
            <option value="generic">generic</option>
          </select>
          <input type="file" accept="image/*" onChange={handleEvidenceFileChange} className="rounded-full border border-black/15 bg-white px-3 py-2 text-xs" />
        </div>
        <textarea value={evidenceNote} onChange={(event) => setEvidenceNote(event.target.value)} rows={2} placeholder="Optional note for the attached evidence" className="mt-3 rounded-xl border border-black/15 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring" />
        {selectedEvidenceFile ? (
          <p className="mt-2 text-xs text-black/60">{selectedEvidenceFile.name} | {Math.round(selectedEvidenceFile.size / 1024)} KB</p>
        ) : null}
        {evidenceProgress > 0 ? (
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/10">
            <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(evidenceProgress * 100)}%` }} />
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={Boolean(chatReason)} onClick={() => void handleSendChat()} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-45">
            {chatBusy ? "Sending..." : composerMode === "clue" ? "Send Clue" : "Send Message"}
          </button>
          <button type="button" disabled={evidenceBusy || !selectedEvidenceFile} onClick={() => void handleUploadEvidence()} className="rounded-full border border-black/15 bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-black hover:text-white disabled:opacity-45">
            {evidenceBusy ? "Uploading..." : "Upload Photo"}
          </button>
        </div>
        {!clueAvailable && isHider && composerMode === "clue" ? (
          <p className="mt-2 text-sm text-signal">Clue is locked until the seek phase passes the configured unlock time.</p>
        ) : null}
        {chatReason ? <p className="mt-2 text-sm text-signal">{chatReason}</p> : null}
        {chatError ? <p className="mt-2 text-sm text-signal">{chatError}</p> : null}
        {evidenceError ? <p className="mt-2 text-sm text-signal">{evidenceError}</p> : null}
      </section>

      <div className="grid gap-4">
        <section className="rounded-xl border border-black/10 bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Conversation</p>
            <span className="rounded-full bg-black/5 px-3 py-1 text-xs text-black/60">{sortedMessages.length} item(s)</span>
          </div>
          <div className="mt-4 flex max-h-[560px] flex-col gap-3 overflow-auto rounded-2xl bg-[#f6f3ea] p-4">
            {sortedMessages.length === 0 ? (
              <p className="text-sm text-black/55">No chat or clue messages yet.</p>
            ) : (
              sortedMessages.map((message, index) => {
                const own = String(message.playerId ?? "") === playerId;
                const kind = asText(message.kind, "chat");
                return (
                  <div key={String(message.id ?? message.messageId ?? index)} className={`flex ${own ? "justify-end" : "justify-start"}`}>
                    <article className={`max-w-[78%] rounded-[20px] px-4 py-3 text-sm shadow-sm ${
                      kind === "clue"
                        ? "bg-emerald-100 text-emerald-950"
                        : own
                          ? "bg-[#0f766e] text-white"
                          : "bg-white text-black/80"
                    }`}>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <span className={`font-semibold ${own && kind !== "clue" ? "text-white/85" : "text-black/55"}`}>
                          {kind === "clue" ? "Clue" : asText(message.playerName, asText(message.playerId, "system"))}
                        </span>
                        <span className={own && kind !== "clue" ? "text-white/65" : "text-black/45"}>{formatDateTime(message.createdAt)}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap">{asText(message.text)}</p>
                    </article>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="rounded-xl border border-black/10 bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Evidence Library</p>
            <span className="rounded-full bg-black/5 px-3 py-1 text-xs text-black/60">{sortedEvidence.length} item(s)</span>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {sortedEvidence.length === 0 ? (
              <p className="text-sm text-black/55">No evidence uploaded yet.</p>
            ) : (
              sortedEvidence.map((item) => (
                <article key={String(item.evidenceId ?? "")} className="rounded-xl border border-black/10 bg-white p-3 text-sm">
                  <p className="font-semibold text-black/85">{asText(item.type, "evidence")} | {asText(item.status, "pending")}</p>
                  <p className="mt-1 text-xs text-black/55">{asText(item.fileName)} | {formatDateTime(item.createdAt)}</p>
                  <p className="mt-1 text-xs text-black/55">{String(item.sizeBytes ?? "-")} bytes</p>
                  {item.viewUrl ? <a href={String(item.viewUrl)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold text-accent hover:underline">Open attachment</a> : null}
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );

  const renderCatchTab = () => (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="rounded-xl border border-black/10 bg-surface p-4">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Catch Claim</p>
        <div className="mt-3 grid gap-3">
          <select value={catchTargetId} onChange={(event) => setCatchTargetId(event.target.value)} className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring">
            <option value="">Select hider target</option>
            {hiderPlayers.map((player) => (
              <option key={player.id} value={player.id}>{player.name ?? player.id}</option>
            ))}
          </select>
          <button type="button" disabled={Boolean(catchReason)} onClick={() => void handleClaimCatch()} className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-45">
            Claim Catch
          </button>
          {catchReason ? <p className="text-sm text-signal">{catchReason}</p> : null}
        </div>
      </section>
      <section className="rounded-xl border border-black/10 bg-surface p-4 text-sm">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Catch Review</p>
        {pendingCatchClaimId ? (
          <div className="mt-3 space-y-4">
            <div className="rounded-xl border border-black/10 bg-white p-3">
              <p className="font-semibold text-black/85">Pending catch claim</p>
              <p className="mt-1 text-xs text-black/55">Claim {pendingCatchClaimId} | Expires {formatDateTime(pendingCatchClaim.expiresAt)}</p>
              <p className="mt-2 text-xs text-black/60">{shortJson(pendingCatchClaim.evaluation ?? pendingCatchClaim.details)}</p>
            </div>
            {(isHider || meRole === "observer") ? (
              <div className="flex gap-2">
                <button type="button" onClick={() => void handleResolveCatch("success")} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white">
                  Confirm Catch
                </button>
                <button type="button" onClick={() => void handleResolveCatch("failed")} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white">
                  Reject Catch
                </button>
              </div>
            ) : (
              <p className="text-black/70">Waiting for hider or observer to confirm whether the catch should end the round.</p>
            )}

            <div className="rounded-xl border border-black/10 bg-white p-4">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Disputes</p>
              <div className="mt-3 grid gap-3">
                <select value={disputeType} onChange={(event) => setDisputeType(event.target.value as DisputeDraftType)} className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring">
                  <option value="generic">generic</option>
                  <option value="place_legitimacy">place_legitimacy</option>
                  <option value="evidence_review">evidence_review</option>
                </select>
                {disputeType === "evidence_review" ? (
                  <select value={selectedDisputeEvidenceId} onChange={(event) => setSelectedDisputeEvidenceId(event.target.value)} className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring">
                    <option value="">Select evidence</option>
                    {sortedEvidence.map((item) => (
                      <option key={String(item.evidenceId ?? "")} value={String(item.evidenceId ?? "")}>{asText(item.fileName, asText(item.evidenceId))}</option>
                    ))}
                  </select>
                ) : null}
                {disputeType === "place_legitimacy" ? (
                  <p className="text-xs text-black/55">Selected POI: {asText(selectedPlace?.name, asText(selectedPlace?.placeId, "none"))}</p>
                ) : null}
                <textarea value={disputeDescription} onChange={(event) => setDisputeDescription(event.target.value)} rows={3} placeholder="Describe what needs review" className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring" />
                <button
                  type="button"
                  disabled={Boolean(disputeOpenReason)}
                  onClick={() => void handleCreateDispute()}
                  className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-45"
                >
                  {disputeBusy ? "Submitting..." : "Open Dispute"}
                </button>
                {disputeOpenReason ? <p className="text-sm text-signal">{disputeOpenReason}</p> : null}
                {disputeError ? <p className="text-sm text-signal">{disputeError}</p> : null}
              </div>
            </div>

            <div className="grid gap-3">
              {sortedDisputes.length === 0 ? (
                <p className="text-sm text-black/55">No disputes yet.</p>
              ) : (
                sortedDisputes.map((dispute) => {
                  const votes = asRecord(dispute.votes);
                  const requiredVoterIds = Array.isArray(dispute.requiredVoterIds) ? dispute.requiredVoterIds.map(String) : [];
                  const canVote = dispute.status === "open" && requiredVoterIds.includes(playerId);
                  return (
                    <article key={String(dispute.id ?? "")} className="rounded-xl border border-black/10 bg-white p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-black/85">{asText(dispute.type, "dispute")} | {asText(dispute.status, "open")}</p>
                        <span className="text-xs text-black/55">{formatDateTime(dispute.createdAt)}</span>
                      </div>
                      <p className="mt-2 text-black/75">{asText(dispute.description)}</p>
                      <p className="mt-2 text-xs text-black/55">Votes {shortJson(votes)}</p>
                      <p className="mt-1 text-xs text-black/55">Resolution {shortJson(dispute.resolution)}</p>
                      {canVote ? (
                        <div className="mt-3 flex gap-2">
                          <button type="button" disabled={voteBusyDisputeId === dispute.id} onClick={() => void handleVoteDispute(String(dispute.id), "accept")} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-45">Accept</button>
                          <button type="button" disabled={voteBusyDisputeId === dispute.id} onClick={() => void handleVoteDispute(String(dispute.id), "reject")} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-45">Reject</button>
                        </div>
                      ) : null}
                    </article>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <ul className="mt-3 space-y-2 text-black/70">
            <li>Use the map to verify seeker and hider positions first.</li>
            <li>Catch is now player-resolved instead of auto-failing immediately.</li>
            <li>Only hider or observer can confirm whether the round actually ends.</li>
          </ul>
        )}
      </section>
    </div>
  );

  const renderLogTab = () => (
    <div className="rounded-xl border border-black/10 bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Event Log</p>
        <span className="rounded-full bg-black/5 px-3 py-1 text-xs text-black/60">{events.length} event(s)</span>
      </div>
      <div className="mt-3 max-h-[760px] space-y-3 overflow-auto pr-1">
        {[...events].reverse().map((event) => (
          <article key={event.id} className="rounded-xl border border-black/10 bg-white p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-black/85">{event.type}</p>
              <span className="text-xs text-black/55">{formatDateTime(event.ts)}</span>
            </div>
            <p className="mt-2 font-mono text-xs text-black/55">{shortJson(event.data)}</p>
          </article>
        ))}
      </div>
    </div>
  );

  const activeTabContent = (() => {
    switch (activeTab) {
      case "map":
        return renderMapTab();
      case "qa":
        return renderQaTab();
      case "cards":
        return renderCardsTab();
      case "rewards":
        return renderRewardsTab();
      case "tools":
        return renderToolsTab();
      case "comms":
        return renderCommsTab();
      case "catch":
        return renderCatchTab();
      case "log":
      default:
        return renderLogTab();
    }
  })();

  return (
    <div className="space-y-4">
      <section className={`rounded-2xl border p-5 ${hero.className}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-black/45">{hero.eyebrow}</p>
            <h2 className="mt-2 font-heading text-2xl font-bold">{hero.title}</h2>
            <p className="mt-2 max-w-3xl text-sm text-black/70">{hero.desc}</p>
          </div>
          <div className="whitespace-pre-line rounded-xl bg-black px-4 py-3 font-mono text-lg font-semibold text-white">
            {heroTimerText}
          </div>
        </div>

        {isSeeker && latestAnsweredEvent ? (
          <div className="mt-4 rounded-xl border border-cyan-400/40 bg-cyan-100/70 p-4 text-sm">
            <p className="font-semibold text-cyan-950">Latest answer received</p>
            <p className="mt-1 text-cyan-950/80">{asText(latestAnswerData.value, "Open Ask to review the answer details.")}</p>
          </div>
        ) : null}

        {myActiveCurses.length > 0 ? (
          <div className="mt-4 rounded-xl border border-amber-400/40 bg-amber-50 p-4 text-sm">
            <p className="font-semibold text-amber-950">Active curse effects</p>
            <div className="mt-2 space-y-1">
              {myActiveCurses.map((curse, index) => {
                const entry = asRecord(curse);
                const effect = asRecord(entry.effect);
                const expiresAtMs = Number(entry.expiresAtMs ?? 0);
                const remaining = Number.isFinite(expiresAtMs) ? Math.max(0, expiresAtMs - uiNowMs) : 0;
                return (
                  <p key={String(entry.id ?? index)} className="text-amber-950/80">
                    {asText(entry.sourceTemplateId, asText(effect.kind, "curse"))} | {asText(effect.kind, "effect")} | {formatCountdownMs(remaining)} left
                  </p>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap gap-2">
        {tabItems.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
              activeTab === tab.key ? "border-black bg-black text-white" : "border-black/15 bg-white text-black/70 hover:border-black/40"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTabContent}
    </div>
  );
}
