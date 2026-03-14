import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { updatePlayerLocation } from "./api";

const LOCATION_TASK_NAME = "JETLAG_LOCATION_TASK";
const TRACKING_CONTEXT_KEY = "jetlag_active_tracking_context";
type LocationTrackingMode = "background" | "foreground";

// Ensure tracking context is globally accessible by the task
let activeTrackingContext: {
  httpBaseUrl: string;
  roomCode: string;
  playerId: string;
} | null = null;

async function loadStoredTrackingContext() {
  try {
    const raw = await AsyncStorage.getItem(TRACKING_CONTEXT_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<{
      httpBaseUrl: string;
      roomCode: string;
      playerId: string;
    }>;
    if (
      typeof parsed.httpBaseUrl !== "string" ||
      typeof parsed.roomCode !== "string" ||
      typeof parsed.playerId !== "string"
    ) {
      return null;
    }

    return {
      httpBaseUrl: parsed.httpBaseUrl,
      roomCode: parsed.roomCode,
      playerId: parsed.playerId,
    };
  } catch {
    return null;
  }
}

async function saveStoredTrackingContext(context: {
  httpBaseUrl: string;
  roomCode: string;
  playerId: string;
}) {
  try {
    await AsyncStorage.setItem(TRACKING_CONTEXT_KEY, JSON.stringify(context));
  } catch {
    // Ignore storage failures and keep live in-memory tracking active.
  }
}

async function clearStoredTrackingContext() {
  try {
    await AsyncStorage.removeItem(TRACKING_CONTEXT_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

// Define the background task outside of React components
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error(`[BackgroundLocation] Task error:`, error);
    return;
  }

  if (!activeTrackingContext) {
    activeTrackingContext = await loadStoredTrackingContext();
  }

  if (!activeTrackingContext) {
    // If context is gone (e.g. app restarted or user left room), stop task.
    // Task manager definitions persist, so we need to clean up self.
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => {});
    return;
  }

  if (data && typeof data === "object" && "locations" in data) {
    const locations = (data as { locations: Location.LocationObject[] }).locations;
    if (locations && locations.length > 0) {
      const loc = locations[locations.length - 1]; // Use most recent

      try {
        await updatePlayerLocation(
          activeTrackingContext.httpBaseUrl,
          activeTrackingContext.roomCode,
          {
            playerId: activeTrackingContext.playerId,
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            accuracy: loc.coords.accuracy ?? undefined,
          }
        );
      } catch (e) {
        console.warn("[BackgroundLocation] Failed to report location:", e);
      }
    }
  }
});

function isExpoGoStoreClient(): boolean {
  const ownership = String((Constants as { appOwnership?: unknown }).appOwnership ?? "").toLowerCase();
  const executionEnvironment = String(
    (Constants as { executionEnvironment?: unknown }).executionEnvironment ?? "",
  ).toLowerCase();
  return ownership === "expo" || executionEnvironment === "storeclient";
}

export function getLocationTrackingMode(): LocationTrackingMode {
  if (Platform.OS === "ios" && isExpoGoStoreClient()) {
    return "foreground";
  }
  return "background";
}

export async function isTrackingActive(): Promise<boolean> {
  return await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
}

export async function stopBackgroundTracking(): Promise<void> {
  activeTrackingContext = null;
  await clearStoredTrackingContext();
  const isRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  if (isRegistered) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
}

export async function startBackgroundTracking(
  httpBaseUrl: string,
  roomCode: string,
  playerId: string
): Promise<boolean> {
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== "granted") {
      console.warn("[BackgroundLocation] Foreground permission denied");
      return false;
    }

    activeTrackingContext = { httpBaseUrl, roomCode, playerId };
    await saveStoredTrackingContext(activeTrackingContext);

    if (getLocationTrackingMode() === "foreground") {
      return true;
    }

    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== "granted") {
      console.warn("[BackgroundLocation] Background permission denied");
      return true;
    }

    // Register for location updates
    const isRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
    if (!isRegistered) {
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
        distanceInterval: 10,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: "Jet Lag App",
          notificationBody: "Location is active for Hide and Seek",
          notificationColor: "#0a5f66",
        },
      });
    }

    return true;
  } catch (err) {
    console.error("[BackgroundLocation] Error starting tracking:", err);
    return false;
  }
}
