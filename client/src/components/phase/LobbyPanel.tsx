import { useEffect, useMemo, useState } from "react";
import { HIDE_DURATION_OPTIONS, ROOM_REGION_PRESETS, findRoomRegionPreset, polygonGeoJsonFromPreset } from "@jetlag/shared/roomConfigPresets";
import type { RoomProjection, TransitPackSummary } from "../../types";

interface LobbyPanelProps {
  projection: RoomProjection | null;
  playerId: string | null;
  transitPacks: TransitPackSummary[];
  busyAction: string | null;
  onUpdateRoomConfig: (payload: {
    transitPackId?: string | null;
    regionPresetId?: string | null;
    regionPresetName?: string | null;
    hideDurationSec?: number | null;
    borderPolygonGeoJSON?: Record<string, unknown> | null;
    hidingAreaGeoJSON?: Record<string, unknown> | null;
  }) => Promise<void>;
}

function parseGeoJsonPolygonCount(value: unknown): number {
  if (!value || typeof value !== "object") {
    return 0;
  }
  const source = value as Record<string, unknown>;
  const geometry = String(source.type ?? "").toLowerCase() === "feature"
    ? (source.geometry as Record<string, unknown> | undefined)
    : source;
  const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : [];
  const ring = Array.isArray(coordinates[0]) ? coordinates[0] : [];
  const points = ring.filter((item) => Array.isArray(item) && item.length >= 2);
  if (points.length >= 2) {
    const first = points[0] as unknown[];
    const last = points[points.length - 1] as unknown[];
    if (Number(first[0]) === Number(last[0]) && Number(first[1]) === Number(last[1])) {
      return Math.max(0, points.length - 1);
    }
  }
  return points.length;
}

function asHideDurationSec(value: unknown): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 30 * 60;
}

export function LobbyPanel({
  projection,
  playerId,
  transitPacks,
  busyAction,
  onUpdateRoomConfig,
}: LobbyPanelProps) {
  const waitingForOthers = Boolean(projection?.viewerPreparedNextRound) && Boolean(projection?.waitingForNextRound);
  const savedTransitPackId = String(projection?.transitPackId ?? projection?.config?.transitPackId ?? "");
  const savedRegionPresetId = String(projection?.config?.regionPresetId ?? "");
  const savedHideDurationSec = asHideDurationSec(
    (projection?.config as Record<string, unknown> | null | undefined)?.hideDurationSec ??
    (projection?.config as { timers?: { hideSeconds?: number } } | null | undefined)?.timers?.hideSeconds,
  );

  const [transitPackId, setTransitPackId] = useState(savedTransitPackId);
  const [regionPresetId, setRegionPresetId] = useState(savedRegionPresetId || ROOM_REGION_PRESETS[0]?.id || "");
  const [hideDurationSec, setHideDurationSec] = useState(savedHideDurationSec);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTransitPackId(savedTransitPackId);
  }, [savedTransitPackId]);

  useEffect(() => {
    setRegionPresetId(savedRegionPresetId || ROOM_REGION_PRESETS[0]?.id || "");
  }, [savedRegionPresetId]);

  useEffect(() => {
    setHideDurationSec(savedHideDurationSec);
  }, [savedHideDurationSec]);

  const selectedPreset = useMemo(() => findRoomRegionPreset(regionPresetId), [regionPresetId]);
  const selectedTransitPack = useMemo(
    () => transitPacks.find((item) => item.packId === transitPackId) ?? null,
    [transitPackId, transitPacks],
  );
  const currentBoundaryCount = parseGeoJsonPolygonCount((projection?.config as Record<string, unknown> | null | undefined)?.borderPolygonGeoJSON);
  const currentHideAreaCount = parseGeoJsonPolygonCount((projection?.config as Record<string, unknown> | null | undefined)?.hidingAreaGeoJSON);

  const configChanged =
    transitPackId !== savedTransitPackId ||
    regionPresetId !== savedRegionPresetId ||
    hideDurationSec !== savedHideDurationSec;

  const configDisabledReason = !playerId
    ? "Join the room first"
    : waitingForOthers
      ? "Room config unlocks after every player prepares the next round"
      : busyAction
        ? "Another action is in progress"
        : !selectedPreset
          ? "Select a district preset"
          : !configChanged
            ? "No config changes to save"
            : null;

  const handleSave = async () => {
    if (configDisabledReason || !selectedPreset) {
      return;
    }
    setError(null);
    try {
      await onUpdateRoomConfig({
        transitPackId: transitPackId.trim() || null,
        regionPresetId: selectedPreset.id,
        regionPresetName: `${selectedPreset.city} / ${selectedPreset.district}`,
        hideDurationSec,
        borderPolygonGeoJSON: polygonGeoJsonFromPreset(selectedPreset.boundary) as Record<string, unknown> | null,
        hidingAreaGeoJSON: polygonGeoJsonFromPreset(selectedPreset.hidingArea) as Record<string, unknown> | null,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save room config");
    }
  };

  return (
    <div className="rounded-xl border border-black/10 bg-surface p-5">
      <p className="font-mono text-xs uppercase tracking-[0.24em] text-black/50">Lobby</p>
      <h2 className="mt-2 font-heading text-2xl font-bold">Room Setup</h2>
      <p className="mt-2 text-sm text-black/70">
        Room setup now follows preset geography instead of hand-drawn polygons. Pick a district range, choose the transit station basis, then set the hiding time before the round starts.
      </p>
      {waitingForOthers ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          You already prepared the next round. Room config stays read-only until the remaining players also click Prepare Next Round.
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="grid gap-4 rounded-xl border border-black/10 bg-white p-4">
          <div className="grid gap-2">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Range (District Preset)</p>
            <div className="grid gap-2">
              {ROOM_REGION_PRESETS.map((preset) => {
                const active = preset.id === regionPresetId;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setRegionPresetId(preset.id)}
                    className={`rounded-xl border px-4 py-3 text-left transition ${
                      active ? "border-accent bg-accent/10 text-accent" : "border-black/10 bg-surface text-black/80 hover:border-accent/40"
                    }`}
                  >
                    <p className="font-semibold">{preset.label}</p>
                    <p className="mt-1 text-xs opacity-80">{preset.city} / {preset.district}</p>
                    <p className="mt-1 text-xs opacity-70">{preset.summary}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="grid gap-2">
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Transit Station Basis</span>
            <select
              value={transitPackId}
              onChange={(event) => setTransitPackId(event.target.value)}
              className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm outline-none ring-accent/40 focus:ring"
            >
              {transitPacks.map((pack) => (
                <option key={pack.packId} value={pack.packId}>
                  {pack.name ?? pack.packId} {pack.city ? `(${pack.city})` : ""}
                </option>
              ))}
            </select>
            <span className="text-xs text-black/55">This controls nearest-station and route-context checks. It does not change the rendered map skin.</span>
          </label>

          <div className="grid gap-2">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Hide Duration</p>
            <div className="flex flex-wrap gap-2">
              {HIDE_DURATION_OPTIONS.map((option) => (
                <button
                  key={option.seconds}
                  type="button"
                  onClick={() => setHideDurationSec(option.seconds)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                    hideDurationSec === option.seconds
                      ? "border-accent bg-accent text-white"
                      : "border-black/15 bg-white text-black/70 hover:border-accent/45"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            disabled={Boolean(configDisabledReason)}
            onClick={() => void handleSave()}
            className="rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-45"
          >
            {busyAction === "config" ? "Saving..." : "Save Room Config"}
          </button>
          {configDisabledReason ? <p className="text-sm text-signal">{configDisabledReason}</p> : null}
          {error ? <p className="text-sm text-signal">{error}</p> : null}
        </section>

        <section className="grid gap-3 rounded-xl border border-black/10 bg-white p-4 text-sm">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-black/45">Resolved Lookup Provider</p>
            <p className="mt-2 rounded-lg border border-black/10 bg-surface px-3 py-2 font-semibold text-black/80">
              {String(projection?.mapProvider ?? projection?.config?.mapProvider ?? "GOOGLE")}
            </p>
          </div>
          <div className="rounded-lg border border-black/10 bg-surface p-3">
            <p className="font-semibold text-black/80">Current Saved Config</p>
            <p className="mt-2 text-black/65">Range preset: {savedRegionPresetId || "not set"}</p>
            <p className="text-black/65">Transit basis: {savedTransitPackId || "default"}</p>
            <p className="text-black/65">Hide duration: {Math.round(savedHideDurationSec / 60)} min</p>
            <p className="text-black/65">Boundary points: {currentBoundaryCount}</p>
            <p className="text-black/65">Hide area points: {currentHideAreaCount}</p>
          </div>
          {selectedPreset ? (
            <div className="rounded-lg border border-black/10 bg-surface p-3">
              <p className="font-semibold text-black/80">Draft Preview</p>
              <p className="mt-2 text-black/65">{selectedPreset.city} / {selectedPreset.district}</p>
              <p className="text-black/65">Boundary points: {selectedPreset.boundary.length}</p>
              <p className="text-black/65">Hide area points: {selectedPreset.hidingArea.length}</p>
            </div>
          ) : null}
          {selectedTransitPack ? (
            <div className="rounded-lg border border-black/10 bg-surface p-3">
              <p className="font-semibold text-black/80">{selectedTransitPack.name ?? selectedTransitPack.packId}</p>
              <p className="mt-2 text-black/65">{selectedTransitPack.city ?? "Unknown city"}</p>
              <p className="text-black/65">Stops: {selectedTransitPack.stopCount ?? 0} | Routes: {selectedTransitPack.routeCount ?? 0}</p>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
