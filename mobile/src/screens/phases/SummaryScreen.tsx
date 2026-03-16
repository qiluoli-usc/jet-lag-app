import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import MapView, { Circle, Marker, Polyline, type LatLng, type Region } from "react-native-maps";
import type { RoomEvent } from "../../types";

interface SummaryScreenProps {
  summary: Record<string, unknown> | null;
  events: RoomEvent[];
  busyAction: string | null;
  onPrepareNextRound: () => void;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown, fallback = "-"): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDuration(sec: unknown): string {
  const total = Math.max(0, Math.round(asNumber(sec, 0)));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatReason(reason: string): string {
  switch (reason) {
    case "catch_success":
    case "catch_success_distance_auto":
      return "Seekers caught the hider";
    case "seek_timer_elapsed":
      return "Seek timer elapsed";
    case "global_timer_elapsed":
      return "Global round timer elapsed";
    case "hider_left_room":
      return "Hider left the room";
    case "all_seekers_left_room":
      return "All seekers left the room";
    default:
      return reason.replace(/_/g, " ");
  }
}

function toPoint(value: unknown): LatLng | null {
  const row = asRecord(value);
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return {
    latitude: lat,
    longitude: lng,
  };
}

function buildRegion(points: LatLng[]): Region {
  if (points.length === 0) {
    return {
      latitude: 31.2304,
      longitude: 121.4737,
      latitudeDelta: 0.08,
      longitudeDelta: 0.08,
    };
  }

  let minLat = points[0].latitude;
  let maxLat = points[0].latitude;
  let minLng = points[0].longitude;
  let maxLng = points[0].longitude;

  for (const point of points) {
    minLat = Math.min(minLat, point.latitude);
    maxLat = Math.max(maxLat, point.latitude);
    minLng = Math.min(minLng, point.longitude);
    maxLng = Math.max(maxLng, point.longitude);
  }

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.5),
    longitudeDelta: Math.max(0.02, (maxLng - minLng) * 1.5),
  };
}

const TIMELINE_TYPES = new Set([
  "phase.hide.started",
  "phase.seek.started",
  "question.asked",
  "question.answered",
  "card.cast",
  "catch.claimed",
  "catch.resolved",
  "summary.generated",
]);

export function SummaryScreen({
  summary,
  events,
  busyAction,
  onPrepareNextRound,
}: SummaryScreenProps) {
  const summaryData = asRecord(summary);
  const winner = asText(summaryData.winner, "unknown");
  const reason = asText(summaryData.reason, "unknown");
  const hider = asRecord(summaryData.hider);
  const hidingZone = asRecord(summaryData.hidingZone);
  const hiderFinalPoint = toPoint(hider.finalLocation);
  const zoneCenter = toPoint(hidingZone.center);

  const seekerTrails = Array.isArray(summaryData.seekerTrails)
    ? summaryData.seekerTrails
        .map((item) => asRecord(item))
        .map((item) => ({
          playerId: asText(item.playerId),
          name: asText(item.name),
          totalDistanceMeters: asNumber(item.totalDistanceMeters),
          points: Array.isArray(item.points)
            ? item.points.map((point) => toPoint(point)).filter((point): point is LatLng => Boolean(point))
            : [],
        }))
    : [];

  const mapPoints = useMemo(() => {
    const allPoints = seekerTrails.flatMap((trail) => trail.points);
    if (hiderFinalPoint) {
      allPoints.push(hiderFinalPoint);
    }
    if (zoneCenter) {
      allPoints.push(zoneCenter);
    }
    return allPoints;
  }, [hiderFinalPoint, seekerTrails, zoneCenter]);

  const timeline = useMemo(() => {
    return [...events]
      .filter((event) => TIMELINE_TYPES.has(event.type))
      .slice(-12)
      .reverse();
  }, [events]);

  const prepareDisabled = Boolean(busyAction);

  return (
    <View style={styles.wrap}>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>Round Summary</Text>
        <Text style={styles.title}>{winner === "seekers" ? "Seekers Win" : "Hider Wins"}</Text>
        <Text style={styles.desc}>{formatReason(reason)}</Text>
      </View>

      <View style={styles.metricsGrid}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Seek Time</Text>
          <Text style={styles.metricValue}>{formatDuration(summaryData.seekDurationSec)}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Hide Time</Text>
          <Text style={styles.metricValue}>{formatDuration(summaryData.effectiveHideDurationSec)}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Base Hide</Text>
          <Text style={styles.metricValue}>{formatDuration(summaryData.hideDurationSec)}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Card Bonus</Text>
          <Text style={styles.metricValue}>{formatDuration(summaryData.handTimeBonusSec)}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Map Recap</Text>
        <MapView style={styles.mapView} initialRegion={buildRegion(mapPoints)}>
          {zoneCenter ? (
            <Circle
              center={zoneCenter}
              radius={Math.max(5, asNumber(hidingZone.radiusMeters, 0))}
              strokeColor="#9a7c2f"
              fillColor="rgba(154,124,47,0.12)"
            />
          ) : null}

          {seekerTrails.map((trail, index) => (
            trail.points.length > 0 ? (
              <Polyline
                key={`trail-${trail.playerId}-${index}`}
                coordinates={trail.points}
                strokeColor={index % 2 === 0 ? "#0a5f66" : "#c76528"}
                strokeWidth={3}
              />
            ) : null
          ))}

          {seekerTrails.map((trail, index) => {
            const lastPoint = trail.points[trail.points.length - 1];
            if (!lastPoint) {
              return null;
            }
            return (
              <Marker
                key={`seeker-end-${trail.playerId}-${index}`}
                coordinate={lastPoint}
                pinColor={index % 2 === 0 ? "#0a5f66" : "#c76528"}
                title={trail.name}
                description={`${Math.round(trail.totalDistanceMeters)}m travelled`}
              />
            );
          })}

          {hiderFinalPoint ? (
            <Marker
              coordinate={hiderFinalPoint}
              pinColor="#8f3f68"
              title={asText(hider.name, "Hider")}
              description="Final hider position"
            />
          ) : null}
        </MapView>

        <Text style={styles.helperText}>
          Purple marker = hider final position. Trail lines = seeker movement during the round.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Route Stats</Text>
        {seekerTrails.length === 0 ? (
          <Text style={styles.helperText}>No seeker route data recorded for this round.</Text>
        ) : (
          seekerTrails.map((trail) => (
            <View key={`trail-stat-${trail.playerId}`} style={styles.rowLine}>
              <Text style={styles.rowTitle}>{trail.name}</Text>
              <Text style={styles.rowValue}>{Math.round(trail.totalDistanceMeters)} m</Text>
            </View>
          ))
        )}

        <View style={styles.separator} />

        <Text style={styles.sectionTitle}>Locations</Text>
        <Text style={styles.helperText}>
          Hider final: {hiderFinalPoint ? `${hiderFinalPoint.latitude.toFixed(5)}, ${hiderFinalPoint.longitude.toFixed(5)}` : "-"}
        </Text>
        <Text style={styles.helperText}>
          Hide zone: {zoneCenter ? `${zoneCenter.latitude.toFixed(5)}, ${zoneCenter.longitude.toFixed(5)}` : "-"}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Timeline</Text>
        <ScrollView style={styles.timelineScroll} contentContainerStyle={styles.timelineInner}>
          {timeline.length === 0 ? (
            <Text style={styles.helperText}>No summary events available.</Text>
          ) : (
            timeline.map((event) => (
              <View key={event.id} style={styles.timelineItem}>
                <Text style={styles.timelineType}>{event.type}</Text>
                <Text style={styles.timelineTime}>{new Date(event.ts).toLocaleTimeString()}</Text>
                <Text style={styles.timelineData}>{JSON.stringify(event.data)}</Text>
              </View>
            ))
          )}
        </ScrollView>
      </View>

      <Pressable
        style={[styles.primaryButton, prepareDisabled ? styles.buttonDisabled : null]}
        disabled={prepareDisabled}
        onPress={onPrepareNextRound}
      >
        <Text style={styles.primaryButtonText}>
          {busyAction === "nextRound" ? "Preparing..." : "Prepare Next Round"}
        </Text>
      </Pressable>
      <Text style={styles.helperText}>
        This resets the room back to Lobby so the next game starts from the initial setup state.
      </Text>
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
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d0d4d9",
    backgroundColor: "#eef3f7",
    padding: 12,
    gap: 4,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "800",
    color: "#4b5965",
    textTransform: "uppercase",
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: "#1f1f1f",
  },
  desc: {
    fontSize: 13,
    color: "#5e5e5e",
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metricCard: {
    minWidth: "47%",
    flexGrow: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d8d6ce",
    backgroundColor: "#f9f9f5",
    padding: 10,
    gap: 3,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#6d675c",
    textTransform: "uppercase",
  },
  metricValue: {
    fontSize: 18,
    fontWeight: "800",
    color: "#232323",
  },
  card: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d8d6ce",
    backgroundColor: "#f9f9f5",
    padding: 10,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#4f4f4f",
    textTransform: "uppercase",
  },
  mapView: {
    width: "100%",
    height: 260,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d8d6ce",
  },
  helperText: {
    fontSize: 12,
    color: "#5e5e5e",
    lineHeight: 17,
  },
  rowLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  rowTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#232323",
  },
  rowValue: {
    fontSize: 13,
    color: "#4f4f4f",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#d8d6ce",
  },
  timelineScroll: {
    maxHeight: 220,
  },
  timelineInner: {
    gap: 8,
    paddingBottom: 6,
  },
  timelineItem: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d6d4cc",
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  timelineType: {
    fontSize: 12,
    fontWeight: "700",
    color: "#232323",
  },
  timelineTime: {
    fontSize: 11,
    color: "#666666",
  },
  timelineData: {
    fontSize: 11,
    color: "#4f4f4f",
  },
  primaryButton: {
    borderRadius: 10,
    backgroundColor: "#0a5f66",
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
