import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet, View } from "react-native";
import { useEffect, useMemo, useState } from "react";
import { HomeScreen } from "./src/screens/HomeScreen";
import { RoomScreen } from "./src/screens/RoomScreen";
import { AuthScreen } from "./src/screens/AuthScreen";
import { SettingsModal } from "./src/components/SettingsModal";
import { getAuthSession, type AuthSession } from "./src/lib/authSession";
import { registerForPushNotificationsAsync, savePushToken } from "./src/lib/pushNotifications";
import {
  getInjectedNetworkBaseUrls,
  loadNetworkBaseUrls,
  resetNetworkBaseUrls,
  saveNetworkBaseUrls,
  type NetworkBaseUrls,
} from "./src/lib/config";
import type { Role } from "./src/types";

const BOOT_CONFIG_TIMEOUT_MS = 1800;

function withTimeout<T>(promise: Promise<T>, fallbackValue: T, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      resolve(fallbackValue);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

type Route =
  | { name: "auth" }
  | { name: "home"; user: AuthSession["user"] }
  | {
      name: "room";
      roomCode: string;
      playerId: string;
      playerName: string;
      role: Role;
      user: AuthSession["user"];
    };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: "auth" });
  const [settingsVisible, setSettingsVisible] = useState(false);
  const injectedNetwork = useMemo(() => getInjectedNetworkBaseUrls(), []);

  const [network, setNetwork] = useState<NetworkBaseUrls>(injectedNetwork);

  useEffect(() => {
    let active = true;

    const boot = async () => {
      const [loadedNetwork, session] = await Promise.all([
        withTimeout(loadNetworkBaseUrls(), injectedNetwork, BOOT_CONFIG_TIMEOUT_MS),
        getAuthSession(),
      ]);

      if (active) {
        setNetwork(loadedNetwork);
        if (session) {
          setRoute({ name: "home", user: session.user });
        } else {
          setRoute({ name: "auth" });
        }
      }
    };

    void boot();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (route.name === "room") {
      let active = true;
      const setupPush = async () => {
        const token = await registerForPushNotificationsAsync();
        if (token && active) {
          await savePushToken(network.httpBaseUrl, route.roomCode, route.playerId, token);
        }
      };
      void setupPush();
      return () => {
        active = false;
      };
    }
  }, [route, network.httpBaseUrl]);

  const openSettings = () => {
    if (!__DEV__) {
      return;
    }
    setSettingsVisible(true);
  };

  const handleSaveSettings = async (payload: { httpBaseUrl: string; wsBaseUrl: string }) => {
    const saved = await saveNetworkBaseUrls(payload);
    setNetwork(saved);
  };

  const handleResetSettings = async () => {
    const reset = await resetNetworkBaseUrls();
    setNetwork(reset);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.root}>
        {route.name === "auth" ? (
          <AuthScreen
             httpBaseUrl={network.httpBaseUrl}
             onOpenSettings={__DEV__ ? openSettings : undefined}
             onLoginSuccess={(session) => {
               setRoute({ name: "home", user: session.user });
             }}
          />
        ) : route.name === "home" ? (
          <HomeScreen
            httpBaseUrl={network.httpBaseUrl}
            wsBaseUrl={network.wsBaseUrl}
            source={network.source}
            currentUser={route.user}
            onLogout={() => {
              setRoute({ name: "auth" });
            }}
            onOpenSettings={__DEV__ ? openSettings : undefined}
            onEnterRoom={(payload) => {
              if (route.name === "home") {
                setRoute({
                  name: "room",
                  roomCode: payload.roomCode,
                  playerId: payload.playerId,
                  playerName: payload.playerName,
                  role: payload.role,
                  user: route.user,
                });
              }
            }}
          />
        ) : (
          <RoomScreen
            roomCode={route.roomCode}
            playerId={route.playerId}
            playerName={route.playerName}
            role={route.role}
            httpBaseUrl={network.httpBaseUrl}
            wsBaseUrl={network.wsBaseUrl}
            onBackHome={() => setRoute({ name: "home", user: route.user })}
          />
        )}
      </View>

      {__DEV__ ? (
        <SettingsModal
          visible={settingsVisible}
          currentHttpBaseUrl={network.httpBaseUrl}
          currentWsBaseUrl={network.wsBaseUrl}
          injectedHttpBaseUrl={injectedNetwork.httpBaseUrl}
          injectedWsBaseUrl={injectedNetwork.wsBaseUrl}
          onClose={() => setSettingsVisible(false)}
          onSave={handleSaveSettings}
          onReset={handleResetSettings}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f5f4ee",
  },
  root: {
    flex: 1,
  },
});
