import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { ApiError } from "./api";
import { getAuthSession } from "./authSession";

// Configure how notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Register the device for push notifications and return the Expo Push Token.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("game-events", {
      name: "Game Events",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#0a5f66",
    });
  }

  if (!Device.isDevice) {
    console.warn("Push notifications are only available on physical devices");
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.warn("Failed to get push token for push notification!");
    return null;
  }

  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;

  if (!projectId) {
    console.warn("EAS projectId not found in app config. Push tokens require projectId.");
    return null;
  }

  try {
    const pushTokenString = (
      await Notifications.getExpoPushTokenAsync({
        projectId,
      })
    ).data;
    return pushTokenString;
  } catch (e: unknown) {
    console.error("Error getting Expo Push Token:", e);
    return null;
  }
}

/**
 * Send the collected push token to our backend
 */
export async function savePushToken(
  httpBaseUrl: string,
  roomCode: string,
  playerId: string,
  token: string
): Promise<void> {
  try {
    const normalizedUrl = httpBaseUrl.replace(/\/+$/, "");
    const session = await getAuthSession();
    const res = await fetch(`${normalizedUrl}/api/push/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.token
          ? {
              Authorization: `Bearer ${session.token}`,
            }
          : {}),
      },
      body: JSON.stringify({
        roomCode,
        playerId,
        token,
        platform: Platform.OS,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      let errorMsg = "Failed to save push token";
      try {
        const json = JSON.parse(text);
        if (json.error?.message) {
          errorMsg = json.error.message;
        }
      } catch {}
      throw new ApiError(res.status, errorMsg);
    }
  } catch (err) {
    console.warn("[PushNotifications] Failed to save push token to server", err);
  }
}
