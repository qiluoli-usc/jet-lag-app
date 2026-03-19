import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { HIDE_DURATION_OPTIONS, ROOM_REGION_PRESETS, findRoomRegionPreset, polygonGeoJsonFromPreset } from "@jetlag/shared/roomConfigPresets";
import MapView, { Marker, Polygon, type LatLng, type Region } from "react-native-maps";
import type { MapProvider, ProjectionPlayer, TransitPackSummary } from "../../types";

const DEFAULT_REGION: Region = {
  latitude: 31.2304,
  longitude: 121.4737,
  latitudeDelta: 0.07,
  longitudeDelta: 0.07,
};

interface LobbyScreenProps {
  roomName?: string;
  players: ProjectionPlayer[];
  playerId: string;
  mapProvider?: MapProvider | string | null;
  transitPackId?: string | null;
  config?: Record<string, unknown> | null;
  borderPolygonGeoJSON?: Record<string, unknown> | null;
  hidingAreaGeoJSON?: Record<string, unknown> | null;
  transitPacks: TransitPackSummary[];
  busyAction: string | null;
  viewerPreparedNextRound?: boolean;
  waitingForNextRound?: boolean;
  nextRoundReadyCount?: number;
  onToggleReady: () => void;
  onStartRound: () => void;
  onUpdateRoomConfig: (payload: {
    transitPackId?: string | null;
    regionPresetId?: string | null;
    regionPresetName?: string | null;
    hideDurationSec?: number | null;
    borderPolygonGeoJSON?: Record<string, unknown> | null;
    hidingAreaGeoJSON?: Record<string, unknown> | null;
  }) => Promise<void>;
}

function startDisabledReason(players: ProjectionPlayer[], busyAction: string | null): string | null {
  if (busyAction) {
    return "Another action is in progress";
  }

  const requiredPlayers = players.filter((item) => item.role !== "observer");
  const hiders = players.filter((item) => item.role === "hider");
  const seekers = players.filter((item) => item.role === "seeker");

  if (hiders.length !== 1) {
    return "Need exactly 1 hider in room";
  }
  if (seekers.length < 1) {
    return "Need at least 1 seeker in room";
  }
  if (requiredPlayers.length === 0) {
    return "No required players joined yet";
  }
  if (!requiredPlayers.every((item) => Boolean(item.ready))) {
    return "All non-observer players must be ready";
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
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

function extractGeoJsonPolygonPoints(value: unknown): LatLng[] {
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

function regionFromPoints(points: LatLng[]): Region | null {
  if (points.length === 0) {
    return null;
  }
  const latitudes = points.map((item) => item.latitude);
  const longitudes = points.map((item) => item.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.6 + 0.01),
    longitudeDelta: Math.max(0.02, (maxLng - minLng) * 1.6 + 0.01),
  };
}

export function LobbyScreen({
  roomName,
  players,
  playerId,
  mapProvider,
  transitPackId,
  config,
  borderPolygonGeoJSON,
  hidingAreaGeoJSON,
  transitPacks,
  busyAction,
  viewerPreparedNextRound,
  waitingForNextRound,
  nextRoundReadyCount,
  onToggleReady,
  onStartRound,
  onUpdateRoomConfig,
}: LobbyScreenProps) {
  const me = players.find((item) => item.id === playerId) ?? null;
  const isReady = Boolean(me?.ready);
  const waitingForOthers = Boolean(viewerPreparedNextRound) && Boolean(waitingForNextRound);
  const normalizedMapProvider = String(mapProvider ?? "GOOGLE").toUpperCase() as MapProvider;
  const [draftTransitPackId, setDraftTransitPackId] = useState<string>(String(transitPackId ?? ""));
  const [geometryError, setGeometryError] = useState<string | null>(null);
  const [draftRegionPresetId, setDraftRegionPresetId] = useState<string>(String(config?.regionPresetId ?? ""));
  const [draftHideDurationSec, setDraftHideDurationSec] = useState<number>(() => {
    const value = Number(
      (config?.hideDurationSec ?? asRecord(config?.timers).hideSeconds) ?? 30 * 60,
    );
    return Number.isFinite(value) && value > 0 ? value : 30 * 60;
  });

  const mapRef = useRef<MapView | null>(null);

  const savedBoundaryPoints = useMemo(() => extractGeoJsonPolygonPoints(borderPolygonGeoJSON), [borderPolygonGeoJSON]);
  const savedHidingAreaPoints = useMemo(() => extractGeoJsonPolygonPoints(hidingAreaGeoJSON), [hidingAreaGeoJSON]);
  const savedRegionPresetId = String(config?.regionPresetId ?? "");
  const savedHideDurationSec = useMemo(() => {
    const value = Number((config?.hideDurationSec ?? asRecord(config?.timers).hideSeconds) ?? 30 * 60);
    return Number.isFinite(value) && value > 0 ? value : 30 * 60;
  }, [config]);
  const selectedRegionPreset = useMemo(
    () => findRoomRegionPreset(draftRegionPresetId || savedRegionPresetId),
    [draftRegionPresetId, savedRegionPresetId],
  );
  const presetBoundaryPoints = useMemo(
    () => (selectedRegionPreset?.boundary ?? []).map((point) => ({ latitude: point.lat, longitude: point.lng })),
    [selectedRegionPreset],
  );
  const presetHidingAreaPoints = useMemo(
    () => (selectedRegionPreset?.hidingArea ?? []).map((point) => ({ latitude: point.lat, longitude: point.lng })),
    [selectedRegionPreset],
  );
  const displayBoundaryPoints = presetBoundaryPoints.length > 0 ? presetBoundaryPoints : savedBoundaryPoints;
  const displayHidingAreaPoints = presetHidingAreaPoints.length > 0 ? presetHidingAreaPoints : savedHidingAreaPoints;
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
          coordinate: point,
        };
      })
      .filter((item): item is { id: string; name: string; role: string; coordinate: LatLng } => Boolean(item));
  }, [players]);

  const readyReason = !me
    ? "Player not found in room projection"
    : waitingForOthers
      ? "Waiting for the remaining players to prepare next round"
    : busyAction
      ? "Another action is in progress"
      : null;

  const startReason = waitingForOthers
    ? "Waiting for the remaining players to prepare next round"
    : startDisabledReason(players, busyAction);
  const configBusy = busyAction === "config";
  const selectedPack = useMemo(
    () => transitPacks.find((item) => item.packId === draftTransitPackId) ?? null,
    [draftTransitPackId, transitPacks],
  );

  useEffect(() => {
    setDraftTransitPackId(String(transitPackId ?? ""));
  }, [transitPackId]);

  useEffect(() => {
    setDraftRegionPresetId(savedRegionPresetId || ROOM_REGION_PRESETS[0]?.id || "");
  }, [savedRegionPresetId]);

  useEffect(() => {
    setDraftHideDurationSec(savedHideDurationSec);
  }, [savedHideDurationSec]);

  const configChanged =
    draftTransitPackId !== String(transitPackId ?? "") ||
    draftRegionPresetId !== savedRegionPresetId ||
    draftHideDurationSec !== savedHideDurationSec;
  const configDisabledReason = !me
    ? "Only joined players can update room config"
    : waitingForOthers
      ? "Room config unlocks after every player prepares next round"
    : busyAction && !configBusy
      ? "Another action is in progress"
      : !selectedRegionPreset
        ? "Choose a district preset first"
        : !configChanged
          ? "No config changes to save"
          : null;

  const handleCenterOnShapes = useCallback(() => {
    if (!mapRef.current) {
      return;
    }
    const targetRegion = regionFromPoints([...displayBoundaryPoints, ...displayHidingAreaPoints]);
    if (!targetRegion) {
      return;
    }
    mapRef.current.animateToRegion(targetRegion, 280);
  }, [displayBoundaryPoints, displayHidingAreaPoints]);

  const handleCenterOnPlayers = useCallback(() => {
    if (!mapRef.current) {
      return;
    }
    const targetRegion = regionFromPoints(playerMarkers.map((item) => item.coordinate));
    if (!targetRegion) {
      return;
    }
    mapRef.current.animateToRegion(targetRegion, 280);
  }, [playerMarkers]);

  const handleSaveConfig = useCallback(async () => {
    if (configDisabledReason) {
      return;
    }

    try {
      await onUpdateRoomConfig({
        transitPackId: draftTransitPackId || undefined,
        regionPresetId: selectedRegionPreset?.id ?? null,
        regionPresetName: selectedRegionPreset ? `${selectedRegionPreset.city} / ${selectedRegionPreset.district}` : null,
        hideDurationSec: draftHideDurationSec,
        borderPolygonGeoJSON: selectedRegionPreset
          ? (polygonGeoJsonFromPreset(selectedRegionPreset.boundary) as Record<string, unknown>)
          : null,
        hidingAreaGeoJSON: selectedRegionPreset
          ? (polygonGeoJsonFromPreset(selectedRegionPreset.hidingArea) as Record<string, unknown>)
          : null,
      });
      setGeometryError(null);
    } catch (caught) {
      setGeometryError(caught instanceof Error ? caught.message : "Failed to save room config");
    }
  }, [
    configDisabledReason,
    draftTransitPackId,
    draftHideDurationSec,
    onUpdateRoomConfig,
    selectedRegionPreset,
  ]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Lobby</Text>
      <Text style={styles.desc}>
        Configure the room by preset district range, transit station basis, and hiding duration before the round starts.
      </Text>
      {waitingForOthers ? (
        <Text style={styles.hintText}>
          You already prepared the next round. Waiting for others: {nextRoundReadyCount ?? 0}/{players.length}.
        </Text>
      ) : null}

      <View style={styles.configBox}>
        <Text style={styles.playersTitle}>Room Config</Text>
        <Text style={styles.configMeta}>Room: {roomName ?? "Untitled Room"}</Text>
        <Text style={styles.configMeta}>Auto POI provider: {normalizedMapProvider}</Text>
        <Text style={styles.configMeta}>Current transit basis: {transitPackId ?? "default"}</Text>
        <Text style={styles.configMeta}>Current district preset: {savedRegionPresetId || "not set"}</Text>
        <Text style={styles.configMeta}>Hide duration: {Math.round(savedHideDurationSec / 60)} min</Text>
        <Text style={styles.configMeta}>Boundary vertices: {displayBoundaryPoints.length}</Text>
        <Text style={styles.configMeta}>Hide area vertices: {displayHidingAreaPoints.length}</Text>

        <Text style={styles.hintText}>
          Lookup provider now follows player location and transit context automatically. The visible iPhone map still uses the native map view.
        </Text>

        <Text style={styles.subTitle}>District Range</Text>
        <View style={styles.packList}>
          {ROOM_REGION_PRESETS.map((preset) => {
            const active = draftRegionPresetId === preset.id;
            return (
              <Pressable
                key={preset.id}
                style={[styles.packButton, active ? styles.packButtonActive : null]}
                onPress={() => setDraftRegionPresetId(preset.id)}
              >
                <Text style={[styles.packButtonTitle, active ? styles.choiceButtonTextActive : null]}>
                  {preset.label}
                </Text>
                <Text style={styles.packButtonMeta}>
                  {preset.city} / {preset.district}
                </Text>
                <Text style={styles.configHint}>{preset.summary}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.separator} />
        <Text style={styles.subTitle}>Transit Station Basis</Text>
        {transitPacks.length === 0 ? (
          <Text style={styles.configHint}>No transit pack list loaded. Server default will be used.</Text>
        ) : (
          <View style={styles.packList}>
            {transitPacks.map((pack) => {
              const active = draftTransitPackId === pack.packId;
              return (
                <Pressable
                  key={pack.packId}
                  style={[styles.packButton, active ? styles.packButtonActive : null]}
                  onPress={() => setDraftTransitPackId(pack.packId)}
                >
                  <Text style={[styles.packButtonTitle, active ? styles.choiceButtonTextActive : null]}>
                    {pack.name ?? pack.packId}
                  </Text>
                  <Text style={styles.packButtonMeta}>
                    {(pack.city ?? "Unknown city")}{pack.stopCount ? ` · ${pack.stopCount} stops` : ""}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {selectedPack ? (
          <Text style={styles.configHint}>Selected: {selectedPack.name ?? selectedPack.packId}</Text>
        ) : null}

        <View style={styles.separator} />
        <Text style={styles.subTitle}>Hide Duration</Text>
        <View style={styles.optionWrap}>
          {HIDE_DURATION_OPTIONS.map((option) => {
            const active = draftHideDurationSec === option.seconds;
            return (
              <Pressable
                key={option.seconds}
                style={[styles.choiceButton, active ? styles.choiceButtonActive : null]}
                onPress={() => setDraftHideDurationSec(option.seconds)}
              >
                <Text style={[styles.choiceButtonText, active ? styles.choiceButtonTextActive : null]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.configHint}>
          Transit basis is used for nearest-station and route-context checks. It is not a visual map theme.
        </Text>

        <View style={styles.separator} />
        <Text style={styles.subTitle}>Preset Preview</Text>
        <Text style={styles.configHint}>
          The selected district preset defines both the playable boundary and the initial hide area. Manual polygon drawing is no longer the primary workflow.
        </Text>

        <MapView
          ref={mapRef}
          style={styles.mapView}
          initialRegion={DEFAULT_REGION}
        >
          {displayBoundaryPoints.length >= 3 ? (
            <Polygon
              coordinates={displayBoundaryPoints}
              strokeColor="#0a5f66"
              fillColor="rgba(10,95,102,0.12)"
              strokeWidth={2}
            />
          ) : null}
          {displayHidingAreaPoints.length >= 3 ? (
            <Polygon
              coordinates={displayHidingAreaPoints}
              strokeColor="#8f3f68"
              fillColor="rgba(143,63,104,0.12)"
              strokeWidth={2}
            />
          ) : null}
          {playerMarkers.map((marker) => (
            <Marker
              key={marker.id}
              coordinate={marker.coordinate}
              title={marker.name}
              description={marker.role}
              pinColor={marker.role === "hider" ? "#8f3f68" : marker.role === "seeker" ? "#0a5f66" : "#7f6f50"}
            />
          ))}
        </MapView>

        <View style={styles.actionRow}>
          <Pressable
            style={[styles.secondaryButton, displayBoundaryPoints.length + displayHidingAreaPoints.length === 0 ? styles.buttonDisabled : null]}
            onPress={handleCenterOnShapes}
            disabled={displayBoundaryPoints.length + displayHidingAreaPoints.length === 0}
          >
            <Text style={styles.secondaryButtonText}>Center On District</Text>
          </Pressable>
        </View>

        <Pressable
          style={[styles.secondaryButton, playerMarkers.length === 0 ? styles.buttonDisabled : null]}
          onPress={handleCenterOnPlayers}
          disabled={playerMarkers.length === 0}
        >
          <Text style={styles.secondaryButtonText}>Center On Players</Text>
        </Pressable>

        <Pressable
          style={[styles.ghostButton, configDisabledReason ? styles.buttonDisabled : null]}
          onPress={() => void handleSaveConfig()}
          disabled={Boolean(configDisabledReason)}
        >
          <Text style={styles.ghostButtonText}>{configBusy ? "Saving Config..." : "Save Room Config"}</Text>
        </Pressable>

        {configDisabledReason ? <Text style={styles.hintText}>Config save disabled: {configDisabledReason}</Text> : null}
        {geometryError ? <Text style={styles.hintText}>{geometryError}</Text> : null}
      </View>

      <View style={styles.actionRow}>
        <Pressable
          style={[styles.primaryButton, readyReason ? styles.buttonDisabled : null]}
          onPress={onToggleReady}
          disabled={Boolean(readyReason)}
        >
          <Text style={styles.primaryButtonText}>{isReady ? "Cancel Ready" : "Set Ready"}</Text>
        </Pressable>

        <Pressable
          style={[styles.secondaryButton, startReason ? styles.buttonDisabled : null]}
          onPress={onStartRound}
          disabled={Boolean(startReason)}
        >
          <Text style={styles.secondaryButtonText}>Start Round</Text>
        </Pressable>
      </View>

      {readyReason ? <Text style={styles.hintText}>Ready disabled: {readyReason}</Text> : null}
      {startReason ? <Text style={styles.hintText}>Start disabled: {startReason}</Text> : null}

      <View style={styles.playersBox}>
        <Text style={styles.playersTitle}>Players ({players.length})</Text>
        {players.length === 0 ? (
          <Text style={styles.playerLine}>No players visible yet</Text>
        ) : (
          players.map((item) => (
            <Text key={item.id} style={styles.playerLine}>
              {item.name ?? item.id.slice(-6)} | {String(item.role ?? "unknown")} | {item.ready ? "ready" : "not ready"}
            </Text>
          ))
        )}
      </View>
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
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#1f1f1f",
  },
  desc: {
    fontSize: 13,
    color: "#5e5e5e",
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
  },
  configBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d8d6ce",
    backgroundColor: "#f9f9f5",
    padding: 10,
    gap: 8,
  },
  configMeta: {
    fontSize: 12,
    color: "#4d4d4d",
  },
  subTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#444444",
    textTransform: "uppercase",
    marginTop: 2,
  },
  optionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  choiceButton: {
    minWidth: 84,
    borderWidth: 1,
    borderColor: "#d2d0c8",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: "center",
    backgroundColor: "#f4f3ee",
  },
  choiceButtonActive: {
    borderColor: "#0a5f66",
    backgroundColor: "#d7eef0",
  },
  choiceButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#666666",
  },
  choiceButtonTextActive: {
    color: "#0a5f66",
  },
  packList: {
    gap: 8,
  },
  packButton: {
    borderWidth: 1,
    borderColor: "#d2d0c8",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#f4f3ee",
    gap: 2,
  },
  packButtonActive: {
    borderColor: "#0a5f66",
    backgroundColor: "#d7eef0",
  },
  packButtonTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1f1f1f",
  },
  packButtonMeta: {
    fontSize: 11,
    color: "#666666",
  },
  configHint: {
    fontSize: 12,
    color: "#5d5d5d",
  },
  mapView: {
    width: "100%",
    height: 260,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d8d6ce",
    overflow: "hidden",
  },
  primaryButton: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: "#0a5f66",
    paddingVertical: 11,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2f2f2f",
    backgroundColor: "#ffffff",
    paddingVertical: 11,
    alignItems: "center",
    paddingHorizontal: 10,
  },
  secondaryButtonText: {
    color: "#2a2a2a",
    fontWeight: "700",
    fontSize: 12,
  },
  ghostButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#0a5f66",
    backgroundColor: "#ffffff",
    paddingVertical: 11,
    alignItems: "center",
  },
  ghostButtonText: {
    color: "#0a5f66",
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  hintText: {
    fontSize: 12,
    color: "#8a2f39",
    fontWeight: "600",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#d8d6ce",
    marginVertical: 2,
  },
  playersBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d8d6ce",
    backgroundColor: "#f9f9f5",
    padding: 10,
    gap: 5,
  },
  playersTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#4f4f4f",
    textTransform: "uppercase",
  },
  playerLine: {
    fontSize: 12,
    color: "#333333",
  },
});
