import AsyncStorage from "@react-native-async-storage/async-storage";

export interface AuthSession {
  token: string;
  user: {
    id: string;
    displayName: string;
    createdAt: string;
  };
}

const AUTH_KEY = "jetlag_auth_session";

export async function saveAuthSession(session: AuthSession): Promise<void> {
  try {
    const json = JSON.stringify(session);
    await AsyncStorage.setItem(AUTH_KEY, json);
  } catch (error) {
    console.error("Failed to save auth session", error);
  }
}

export async function getAuthSession(): Promise<AuthSession | null> {
  try {
    const json = await AsyncStorage.getItem(AUTH_KEY);
    if (!json) {
      return null;
    }
    return JSON.parse(json) as AuthSession;
  } catch (error) {
    console.error("Failed to parse auth session", error);
    return null;
  }
}

export async function clearAuthSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(AUTH_KEY);
  } catch (error) {
    console.error("Failed to clear auth session", error);
  }
}
