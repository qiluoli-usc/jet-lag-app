import { useEffect, useMemo, useState } from "react";
import type { RoomProjection, TransitPackSummary } from "../../types";

interface LobbyPanelProps {
  projection: RoomProjection | null;
  playerId: string | null;
  transitPacks: TransitPackSummary[];
  busyAction: string | null;
  onUpdateRoomConfig: (payload: {
    transitPackId?: string | null;
    borderPolygonGeoJSON?: Record<string, unknown> | null;
    hidingAreaGeoJSON?: Record<string, unknown> | null;
  }) => Promise<void>;
}

type DrawTarget = "boundary" | "hidingArea";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asNullableRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseGeoJsonPolygon(value: unknown): Array<{ lat: number; lng: number }> {
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
      return { lat: Number(lat), lng: Number(lng) };
    })
    .filter((item): item is { lat: number; lng: number } => Boolean(item));

  if (points.length >= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first.lat === last.lat && first.lng === last.lng) {
      return points.slice(0, -1);
    }
  }
  return points;
}

function polygonGeoJson(points: Array<{ lat: number; lng: number }>) {
  if (points.length < 3) {
    return null;
  }
  const closed = [...points, points[0]];
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        closed.map((point) => [
          Number(point.lng.toFixed(6)),
          Number(point.lat.toFixed(6)),
        ]),
      ],
    },
    properties: {},
  };
}

export function LobbyPanel({
  projection,
  playerId,
  transitPacks,
  busyAction,
  onUpdateRoomConfig,
}: LobbyPanelProps) {
  const [transitPackId, setTransitPackId] = useState("");
  const [drawTarget, setDrawTarget] = useState<DrawTarget>("boundary");
  const [latInput, setLatInput] = useState("");
  const [lngInput, setLngInput] = useState("");
  const [boundaryDraft, setBoundaryDraft] = useState<Array<{ lat: number; lng: number }>>([]);
  const [hidingAreaDraft, setHidingAreaDraft] = useState<Array<{ lat: number; lng: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const waitingForOthers = Boolean(projection?.viewerPreparedNextRound) && Boolean(projection?.waitingForNextRound);

  const savedBoundary = useMemo(
    () => parseGeoJsonPolygon(projection?.config?.borderPolygonGeoJSON),
    [projection?.config],
  );
  const savedHidingArea = useMemo(
    () => parseGeoJsonPolygon(projection?.config?.hidingAreaGeoJSON),
    [projection?.config],
  );
  useEffect(() => {
    setTransitPackId(String(projection?.transitPackId ?? projection?.config?.transitPackId ?? ""));
  }, [projection?.config?.transitPackId, projection?.transitPackId]);

  const resolvedMapProvider = String(projection?.mapProvider ?? projection?.config?.mapProvider ?? "GOOGLE");

  const activeDraft = drawTarget === "boundary" ? boundaryDraft : hidingAreaDraft;

  const handleAddPoint = () => {
    const lat = toFiniteNumber(latInput);
    const lng = toFiniteNumber(lngInput);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setError("Latitude and longitude must be valid numbers");
      return;
    }
    setError(null);
    const point = { lat: Number(lat), lng: Number(lng) };
    if (drawTarget === "boundary") {
      setBoundaryDraft((prev) => [...prev, point].slice(-30));
    } else {
      setHidingAreaDraft((prev) => [...prev, point].slice(-30));
    }
    setLatInput("");
    setLngInput("");
  };

  const handleUndo = () => {
    if (drawTarget === "boundary") {
      setBoundaryDraft((prev) => prev.slice(0, -1));
    } else {
      setHidingAreaDraft((prev) => prev.slice(0, -1));
    }
  };

  const handleClear = () => {
    if (drawTarget === "boundary") {
      setBoundaryDraft([]);
    } else {
      setHidingAreaDraft([]);
    }
  };

  const handleRestoreSaved = () => {
    if (drawTarget === "boundary") {
      setBoundaryDraft(savedBoundary);
    } else {
      setHidingAreaDraft(savedHidingArea);
    }
  };

  const handleSave = async () => {
    if (!playerId) {
      setError("Join the room first");
      return;
    }
    const boundaryGeoJson = boundaryDraft.length > 0
      ? polygonGeoJson(boundaryDraft)
      : asNullableRecord(projection?.config?.borderPolygonGeoJSON);
    const hidingAreaGeoJson = hidingAreaDraft.length > 0
      ? polygonGeoJson(hidingAreaDraft)
      : asNullableRecord(projection?.config?.hidingAreaGeoJSON);
    if (boundaryDraft.length > 0 && !boundaryGeoJson) {
      setError("Boundary needs at least 3 points");
      return;
    }
    if (hidingAreaDraft.length > 0 && !hidingAreaGeoJson) {
      setError("Hide area needs at least 3 points");
      return;
    }

    setError(null);
    try {
      await onUpdateRoomConfig({
        transitPackId: transitPackId.trim() || null,
        borderPolygonGeoJSON: boundaryGeoJson,
        hidingAreaGeoJSON: hidingAreaGeoJson,
      });
      setBoundaryDraft([]);
      setHidingAreaDraft([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save lobby config");
    }
  };

  return (
    <div className="rounded-xl border border-black/10 bg-surface p-5">
      <p className="font-mono text-xs uppercase tracking-[0.24em] text-black/50">Lobby</p>
      <h2 className="mt-2 font-heading text-2xl font-bold">Room Config + Map Setup</h2>
      <p className="mt-2 text-sm text-black/70">
        Configure the room transit pack plus the boundary / hide-area polygons before the round starts. POI lookup provider now resolves automatically from player location and transit context.
      </p>
      {waitingForOthers ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          You already prepared the next round. Room config stays read-only until the remaining players also click Prepare Next Round.
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="grid gap-2 rounded-xl border border-black/10 bg-white p-4 text-sm">
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Auto POI Provider</span>
          <p className="rounded-lg border border-black/10 bg-surface px-3 py-2 font-semibold text-black/80">
            {resolvedMapProvider}
          </p>
          <span className="text-xs text-black/55">Resolved from the room's current locations and transit geography.</span>
        </div>
        <label className="grid gap-2 rounded-xl border border-black/10 bg-white p-4 text-sm">
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Transit Pack</span>
          <select
            value={transitPackId}
            onChange={(event) => setTransitPackId(event.target.value)}
            className="rounded-lg border border-black/20 bg-white px-3 py-2 outline-none ring-accent/40 focus:ring"
          >
            <option value="">None</option>
            {transitPacks.map((pack) => (
              <option key={pack.packId} value={pack.packId}>
                {pack.name ?? pack.packId} {pack.city ? `(${pack.city})` : ""}
              </option>
            ))}
          </select>
          <span className="text-xs text-black/55">Used for nearest-station and route-context checks during seeking.</span>
        </label>
      </div>

      <div className="mt-4 rounded-xl border border-black/10 bg-white p-4">
        <div className="flex flex-wrap gap-2">
          {([
            { key: "boundary", label: "Boundary" },
            { key: "hidingArea", label: "Hide Area" },
          ] as const).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setDrawTarget(item.key)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
                drawTarget === item.key
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-black/15 bg-white text-black/70"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <input
            value={latInput}
            onChange={(event) => setLatInput(event.target.value)}
            placeholder="Latitude"
            className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring"
          />
          <input
            value={lngInput}
            onChange={(event) => setLngInput(event.target.value)}
            placeholder="Longitude"
            className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring"
          />
          <button
            type="button"
            onClick={handleAddPoint}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white transition hover:brightness-95"
          >
            Add Point
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleUndo}
            disabled={activeDraft.length === 0}
            className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={activeDraft.length === 0}
            className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Clear Draft
          </button>
          <button
            type="button"
            onClick={handleRestoreSaved}
            className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm font-semibold"
          >
            Restore Saved
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-black/10 bg-surface p-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-black/50">
              Active Draft ({activeDraft.length})
            </p>
            <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs">
              {activeDraft.length === 0 ? (
                <li className="text-black/55">No draft points</li>
              ) : (
                activeDraft.map((point, index) => (
                  <li key={`${point.lat}-${point.lng}-${index}`} className="font-mono text-black/75">
                    {index + 1}. {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
                  </li>
                ))
              )}
            </ul>
          </div>
          <div className="rounded-lg border border-black/10 bg-surface p-3 text-xs text-black/70">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-black/50">Saved Shapes</p>
            <p className="mt-2">Boundary: {savedBoundary.length} points</p>
            <p>Hide Area: {savedHidingArea.length} points</p>
            <p className="mt-3">Draft points are saved as GeoJSON polygons into the room config.</p>
          </div>
        </div>

        <button
          type="button"
          disabled={Boolean(busyAction) || waitingForOthers}
          onClick={() => void handleSave()}
          className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50"
        >
          {busyAction === "config" ? "Saving..." : "Save Room Config"}
        </button>
        {error ? <p className="mt-3 text-sm font-medium text-signal">{error}</p> : null}
      </div>
    </div>
  );
}
