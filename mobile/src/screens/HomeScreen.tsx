import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { createRoom, joinRoom } from "../lib/api";
import { clearAllPlayerSessions, clearPlayerSession, getPlayerSession, savePlayerSession } from "../lib/playerSession";
import { clearAuthSession, type AuthSession } from "../lib/authSession";
import type { NetworkConfigSource } from "../lib/config";
import { stopBackgroundTracking } from "../lib/locationTracking";
import type { Role } from "../types";

interface HomeScreenProps {
  httpBaseUrl: string;
  wsBaseUrl: string;
  source: NetworkConfigSource;
  currentUser: AuthSession["user"];
  onLogout: () => void;
  onOpenSettings?: () => void;
  onEnterRoom: (payload: {
    roomCode: string;
    playerId: string;
    playerName: string;
    role: Role;
  }) => void;
}

export function HomeScreen({
  httpBaseUrl,
  wsBaseUrl,
  source,
  currentUser,
  onLogout,
  onOpenSettings,
  onEnterRoom,
}: HomeScreenProps) {
  const [roomName, setRoomName] = useState("Mobile Room");
  const [joinCode, setJoinCode] = useState("");
  const [createRole, setCreateRole] = useState<Role>("seeker");
  const [joinRole, setJoinRole] = useState<Role>("seeker");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogout = async () => {
    await stopBackgroundTracking();
    await clearAllPlayerSessions();
    await clearAuthSession();
    onLogout();
  };

  const handleCreateRoom = async () => {
    setBusy(true);
    setError(null);

    try {
      const created = await createRoom(httpBaseUrl, roomName.trim() || "Mobile Room");
      const code = String(created.code ?? created.room?.code ?? "").trim().toUpperCase();
      if (!code) {
        throw new Error("Server did not return room code");
      }

      const previous = await getPlayerSession(code);
      const joined = await joinRoom(httpBaseUrl, code, {
        name: currentUser.displayName,
        role: createRole,
        playerId: previous?.playerId,
      });

      const session = {
        roomCode: code,
        playerId: joined.player.id,
        playerName: joined.player.name,
        role: joined.player.role,
      };
      await savePlayerSession(session);

      onEnterRoom(session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Create room failed");
    } finally {
      setBusy(false);
    }
  };

  const handleJoinRoom = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setError("Room code is required");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const existing = await getPlayerSession(code);
      const joined = await joinRoom(httpBaseUrl, code, {
        name: currentUser.displayName,
        role: joinRole,
        playerId: existing?.playerId,
      });

      const session = {
        roomCode: code,
        playerId: joined.player.id,
        playerName: joined.player.name,
        role: joined.player.role,
      };
      await savePlayerSession(session);

      onEnterRoom(session);
    } catch (caught) {
      await clearPlayerSession(code);
      setError(caught instanceof Error ? caught.message : "Join room failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Jet Lag Mobile</Text>
      <Text style={styles.caption}>HTTP: {httpBaseUrl}</Text>
      <Text style={styles.caption}>WS: {wsBaseUrl}</Text>
      <Text style={styles.caption}>Config source: {source}</Text>

      {onOpenSettings ? (
        <Pressable style={styles.settingsButton} onPress={onOpenSettings}>
          <Text style={styles.settingsButtonText}>Open Dev Settings</Text>
        </Pressable>
      ) : null}

      <View style={styles.topRow}>
        <View style={styles.userInfo}>
          <Text style={styles.userGreeting}>Hello, {currentUser.displayName}</Text>
          <Text style={styles.caption}>ID: {currentUser.id.slice(-6)}</Text>
        </View>
        <Pressable style={styles.logoutButton} onPress={() => void handleLogout()}>
          <Text style={styles.logoutButtonText}>Logout</Text>
        </Pressable>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Create Room</Text>
        <TextInput
          value={roomName}
          onChangeText={setRoomName}
          placeholder="Room name"
          style={styles.input}
          autoCapitalize="none"
        />

        <Text style={styles.sectionTitle}>Role</Text>

        <View style={styles.roleRow}>
          {(["hider", "seeker", "observer"] as const).map((item) => {
            const active = createRole === item;
            return (
              <Pressable
                key={item}
                style={[styles.roleButton, active ? styles.roleButtonActive : null]}
                onPress={() => setCreateRole(item)}
              >
                <Text style={[styles.roleButtonText, active ? styles.roleButtonTextActive : null]}>
                  {item.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable style={styles.primaryButton} onPress={handleCreateRoom} disabled={busy}>
          <Text style={styles.primaryButtonText}>Create And Join</Text>
        </Pressable>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Join Existing Room</Text>
        <TextInput
          value={joinCode}
          onChangeText={setJoinCode}
          placeholder="Room code"
          style={styles.input}
          autoCapitalize="characters"
        />
        <Text style={styles.sectionTitle}>Join Role</Text>
        <View style={styles.roleRow}>
          {(["hider", "seeker", "observer"] as const).map((item) => {
            const active = joinRole === item;
            return (
              <Pressable
                key={`join_${item}`}
                style={[styles.roleButton, active ? styles.roleButtonActive : null]}
                onPress={() => setJoinRole(item)}
              >
                <Text style={[styles.roleButtonText, active ? styles.roleButtonTextActive : null]}>
                  {item.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable style={styles.secondaryButton} onPress={handleJoinRoom} disabled={busy}>
          <Text style={styles.secondaryButtonText}>Join Room</Text>
        </Pressable>
      </View>

      {busy ? <ActivityIndicator style={styles.loader} size="small" color="#0a5f66" /> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 14,
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    color: "#1f1f1f",
  },
  caption: {
    fontSize: 12,
    color: "#5a5a5a",
  },
  settingsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  settingsButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#0a5f66",
    backgroundColor: "#d7eef0",
  },
  settingsButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0a5f66",
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#ffffff",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d9d6cd",
  },
  userInfo: {
    flex: 1,
  },
  userGreeting: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1f1f1f",
  },
  logoutButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#b42332",
    backgroundColor: "#fbeef0",
  },
  logoutButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#b42332",
  },
  panel: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    borderColor: "#d9d6cd",
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#333333",
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 1,
    borderColor: "#c8c7c0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#f9f9f6",
    fontSize: 15,
  },
  roleRow: {
    flexDirection: "row",
    gap: 8,
  },
  roleButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d2d0c8",
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: "center",
    backgroundColor: "#f4f3ee",
  },
  roleButtonActive: {
    borderColor: "#0a5f66",
    backgroundColor: "#d7eef0",
  },
  roleButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#666666",
  },
  roleButtonTextActive: {
    color: "#0a5f66",
  },
  primaryButton: {
    marginTop: 4,
    backgroundColor: "#0a5f66",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 15,
  },
  secondaryButton: {
    marginTop: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#1f1f1f",
    backgroundColor: "#ffffff",
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#1f1f1f",
    fontWeight: "700",
    fontSize: 15,
  },
  loader: {
    marginTop: 4,
  },
  errorText: {
    color: "#b42332",
    fontSize: 13,
    fontWeight: "600",
  },
});
