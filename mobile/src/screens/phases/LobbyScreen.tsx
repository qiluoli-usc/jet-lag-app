import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ProjectionPlayer } from "../../types";

interface LobbyScreenProps {
  players: ProjectionPlayer[];
  playerId: string;
  busyAction: string | null;
  onToggleReady: () => void;
  onStartRound: () => void;
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

export function LobbyScreen({
  players,
  playerId,
  busyAction,
  onToggleReady,
  onStartRound,
}: LobbyScreenProps) {
  const me = players.find((item) => item.id === playerId) ?? null;
  const isReady = Boolean(me?.ready);

  const readyReason = !me
    ? "Player not found in room projection"
    : busyAction
      ? "Another action is in progress"
      : null;

  const startReason = startDisabledReason(players, busyAction);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Lobby</Text>
      <Text style={styles.desc}>Set ready first. Start round when team composition and readiness are valid.</Text>

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
  },
  secondaryButtonText: {
    color: "#2a2a2a",
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