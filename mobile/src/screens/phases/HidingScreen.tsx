import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { getProjectionPlayers } from "../../lib/projection";
import type { Projection } from "../../types";

interface HidingScreenProps {
  projection: Projection | null;
  playerId: string;
}

function formatRemainingMs(value: number | null): string {
  if (value === null) {
    return "--:--";
  }

  const totalSec = Math.max(0, Math.ceil(value / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function HidingScreen({ projection, playerId }: HidingScreenProps) {
  const players = useMemo(() => getProjectionPlayers(projection), [projection]);
  const me = useMemo(() => players.find((item) => item.id === playerId) ?? null, [playerId, players]);
  const hideEndsAt = typeof projection?.round?.hideEndsAt === "string"
    ? Date.parse(projection.round.hideEndsAt)
    : NaN;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const remainingMs = Number.isFinite(hideEndsAt) ? Math.max(0, hideEndsAt - nowMs) : null;
  const seekerNames = players
    .filter((item) => item.role === "seeker")
    .map((item) => item.name ?? item.id.slice(-6));
  const hiderName = players.find((item) => item.role === "hider")?.name ?? "Unknown";

  return (
    <View style={styles.wrap}>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>Hiding Phase</Text>
        <Text style={styles.title}>Round {Number(projection?.round?.number ?? 1)}</Text>
        <Text style={styles.desc}>
          {String(me?.role ?? "").toLowerCase() === "hider"
            ? "Keep moving and hide before seekers are released."
            : "Hold position. Seekers cannot act until the hiding timer ends."}
        </Text>
      </View>

      <View style={styles.timerCard}>
        <Text style={styles.timerLabel}>Time Remaining</Text>
        <Text style={styles.timerValue}>{formatRemainingMs(remainingMs)}</Text>
        <Text style={styles.timerMeta}>
          {Number.isFinite(hideEndsAt) ? `Seek unlocks at ${new Date(hideEndsAt).toLocaleTimeString()}` : "Hide timer pending"}
        </Text>
      </View>

      <View style={styles.rosterCard}>
        <Text style={styles.sectionTitle}>Round Roles</Text>
        <Text style={styles.playerLine}>Hider: {hiderName}</Text>
        <Text style={styles.playerLine}>
          Seekers: {seekerNames.length > 0 ? seekerNames.join(", ") : "No seekers yet"}
        </Text>
        <Text style={styles.playerLine}>
          You: {(me?.name ?? playerId.slice(-6))} / {String(me?.role ?? "observer")}
        </Text>
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
  heroCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#c9d6d8",
    backgroundColor: "#eef7f7",
    padding: 12,
    gap: 4,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "800",
    color: "#4a5d60",
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
    lineHeight: 18,
  },
  timerCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d8d6ce",
    backgroundColor: "#f9f9f5",
    padding: 14,
    gap: 4,
    alignItems: "center",
  },
  timerLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#6d675c",
    textTransform: "uppercase",
  },
  timerValue: {
    fontSize: 34,
    fontWeight: "900",
    color: "#0a5f66",
    letterSpacing: 1,
  },
  timerMeta: {
    fontSize: 12,
    color: "#5e5e5e",
  },
  rosterCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d8d6ce",
    backgroundColor: "#ffffff",
    padding: 12,
    gap: 6,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#4f4f4f",
    textTransform: "uppercase",
  },
  playerLine: {
    fontSize: 13,
    color: "#333333",
  },
});
