import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

interface SettingsModalProps {
  visible: boolean;
  currentHttpBaseUrl: string;
  currentWsBaseUrl: string;
  injectedHttpBaseUrl: string;
  injectedWsBaseUrl: string;
  onClose: () => void;
  onSave: (payload: { httpBaseUrl: string; wsBaseUrl: string }) => Promise<void>;
  onReset: () => Promise<void>;
}

export function SettingsModal({
  visible,
  currentHttpBaseUrl,
  currentWsBaseUrl,
  injectedHttpBaseUrl,
  injectedWsBaseUrl,
  onClose,
  onSave,
  onReset,
}: SettingsModalProps) {
  const [httpBaseUrlInput, setHttpBaseUrlInput] = useState(currentHttpBaseUrl);
  const [wsBaseUrlInput, setWsBaseUrlInput] = useState(currentWsBaseUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setHttpBaseUrlInput(currentHttpBaseUrl);
    setWsBaseUrlInput(currentWsBaseUrl);
    setError(null);
  }, [visible, currentHttpBaseUrl, currentWsBaseUrl]);

  const hasChanges = useMemo(() => {
    return (
      httpBaseUrlInput.trim() !== currentHttpBaseUrl ||
      wsBaseUrlInput.trim() !== currentWsBaseUrl
    );
  }, [httpBaseUrlInput, wsBaseUrlInput, currentHttpBaseUrl, currentWsBaseUrl]);

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({
        httpBaseUrl: httpBaseUrlInput,
        wsBaseUrl: wsBaseUrlInput,
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save settings");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setBusy(true);
    setError(null);
    try {
      await onReset();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to reset settings");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>Dev Network Settings</Text>
            <Text style={styles.caption}>Use LAN IP on real phone, use 10.0.2.2 on Android emulator.</Text>

            <Text style={styles.label}>HTTP_BASE_URL</Text>
            <TextInput
              value={httpBaseUrlInput}
              onChangeText={setHttpBaseUrlInput}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              placeholder="http://10.0.2.2:8080"
            />

            <Text style={styles.label}>WS_BASE_URL</Text>
            <TextInput
              value={wsBaseUrlInput}
              onChangeText={setWsBaseUrlInput}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              placeholder="ws://10.0.2.2:8080/ws"
            />

            <View style={styles.hintBox}>
              <Text style={styles.hintLine}>Injected HTTP: {injectedHttpBaseUrl}</Text>
              <Text style={styles.hintLine}>Injected WS: {injectedWsBaseUrl}</Text>
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <View style={styles.buttonRow}>
              <Pressable style={styles.ghostButton} onPress={onClose} disabled={busy}>
                <Text style={styles.ghostButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.warnButton} onPress={handleReset} disabled={busy}>
                <Text style={styles.warnButtonText}>Reset</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryButton, !hasChanges ? styles.primaryButtonDisabled : null]}
                onPress={handleSave}
                disabled={busy || !hasChanges}
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Save</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    justifyContent: "flex-end",
  },
  card: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: "#ffffff",
    maxHeight: "84%",
  },
  content: {
    padding: 16,
    gap: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#1f1f1f",
  },
  caption: {
    fontSize: 12,
    color: "#585858",
  },
  label: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "700",
    color: "#2a2a2a",
  },
  input: {
    borderWidth: 1,
    borderColor: "#cdcbc3",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#f7f7f3",
    fontSize: 14,
  },
  hintBox: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: "#ddd9cf",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#f7f3e9",
    gap: 4,
  },
  hintLine: {
    fontSize: 11,
    color: "#4f4f4f",
  },
  errorText: {
    marginTop: 4,
    color: "#b42332",
    fontSize: 12,
    fontWeight: "600",
  },
  buttonRow: {
    marginTop: 8,
    flexDirection: "row",
    gap: 8,
  },
  ghostButton: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#afafa9",
    paddingVertical: 11,
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  ghostButtonText: {
    color: "#3f3f3f",
    fontWeight: "700",
  },
  warnButton: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#c48f97",
    paddingVertical: 11,
    alignItems: "center",
    backgroundColor: "#fff0f2",
  },
  warnButtonText: {
    color: "#9e2232",
    fontWeight: "700",
  },
  primaryButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
    backgroundColor: "#0a5f66",
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "800",
  },
});