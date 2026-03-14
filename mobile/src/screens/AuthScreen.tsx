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
import { loginUser, registerUser } from "../lib/api";
import { saveAuthSession, type AuthSession } from "../lib/authSession";

interface AuthScreenProps {
  httpBaseUrl: string;
  onOpenSettings?: () => void;
  onLoginSuccess: (session: AuthSession) => void;
}

type Mode = "login" | "register";

export function AuthScreen({ httpBaseUrl, onOpenSettings, onLoginSuccess }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setError("Username is required");
      return;
    }
    if (!password) {
      setError("Password is required");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response =
        mode === "login"
          ? await loginUser(httpBaseUrl, trimmedName, password)
          : await registerUser(httpBaseUrl, trimmedName, password);

      const session: AuthSession = {
        token: response.token,
        user: response.user,
      };

      await saveAuthSession(session);
      onLoginSuccess(session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `${mode} failed`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={styles.title}>Jet Lag Mobile</Text>
        <Text style={styles.subtitle}>Authentication required</Text>
      </View>

      {onOpenSettings ? (
        <View style={styles.settingsRow}>
          <Text style={styles.caption}>Backend: {httpBaseUrl}</Text>
          <Pressable style={styles.settingsButton} onPress={onOpenSettings}>
            <Text style={styles.settingsButtonText}>Network Settings</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.panel}>
        <View style={styles.tabRow}>
          <Pressable
            style={[styles.tab, mode === "login" && styles.tabActive]}
            onPress={() => {
              setMode("login");
              setError(null);
            }}
          >
            <Text style={[styles.tabText, mode === "login" && styles.tabTextActive]}>Login</Text>
          </Pressable>
          <Pressable
            style={[styles.tab, mode === "register" && styles.tabActive]}
            onPress={() => {
              setMode("register");
              setError(null);
            }}
          >
            <Text style={[styles.tabText, mode === "register" && styles.tabTextActive]}>Register</Text>
          </Pressable>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Enter username"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Enter password"
            secureTextEntry
            style={styles.input}
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {busy ? <ActivityIndicator style={styles.loader} color="#0a5f66" /> : null}

          <Pressable style={styles.primaryButton} onPress={() => void handleSubmit()} disabled={busy}>
            <Text style={styles.primaryButtonText}>
              {mode === "login" ? "Login" : "Create Account"}
            </Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    gap: 20,
    justifyContent: "center",
    flexGrow: 1,
  },
  header: {
    alignItems: "center",
    marginBottom: 10,
  },
  title: {
    fontSize: 32,
    fontWeight: "800",
    color: "#0a5f66",
  },
  subtitle: {
    fontSize: 16,
    color: "#5a5a5a",
    marginTop: 4,
  },
  settingsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#ffffff",
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d9d6cd",
  },
  caption: {
    fontSize: 11,
    color: "#5a5a5a",
    flex: 1,
  },
  settingsButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#0a5f66",
    backgroundColor: "#d7eef0",
    marginLeft: 10,
  },
  settingsButtonText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0a5f66",
  },
  panel: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderColor: "#d9d6cd",
    borderWidth: 1,
    overflow: "hidden",
  },
  tabRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e3db",
  },
  tab: {
    flex: 1,
    paddingVertical: 16,
    alignItems: "center",
    backgroundColor: "#f9f9f6",
  },
  tabActive: {
    backgroundColor: "#ffffff",
    borderBottomWidth: 3,
    borderBottomColor: "#0a5f66",
  },
  tabText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#8a8a8a",
  },
  tabTextActive: {
    color: "#0a5f66",
    fontWeight: "700",
  },
  form: {
    padding: 20,
    gap: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    color: "#333333",
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 1,
    borderColor: "#c8c7c0",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#fcfcfb",
    fontSize: 16,
  },
  primaryButton: {
    marginTop: 8,
    backgroundColor: "#0a5f66",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 16,
  },
  errorText: {
    color: "#b42332",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  loader: {
    marginVertical: 4,
  },
});
