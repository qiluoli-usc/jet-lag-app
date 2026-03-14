import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

const STORAGE_KEY = "jetlag.mobile.network.base.v1";

export type NetworkConfigSource = "default" | "env" | "app_config" | "storage";

export interface NetworkBaseUrls {
  httpBaseUrl: string;
  wsBaseUrl: string;
  source: NetworkConfigSource;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asPort(value: unknown): number | null {
  const text = asNonEmptyString(value);
  if (!text) {
    return null;
  }
  const parsed = Number.parseInt(text, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : null;
}

function normalizeHttpBaseUrl(value: unknown): string | null {
  const raw = asNonEmptyString(value);
  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (url.pathname === "/") {
      url.pathname = "";
    }
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function normalizeWsBaseUrl(value: unknown): string | null {
  const raw = asNonEmptyString(value);
  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      return null;
    }
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/ws";
    }
    if (url.pathname.endsWith("/") && url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function toWsUrl(httpBaseUrl: string): string {
  const normalizedHttp = normalizeHttpBaseUrl(httpBaseUrl);
  if (!normalizedHttp) {
    return "ws://10.0.2.2:8080/ws";
  }

  const wsCandidate = normalizedHttp
    .replace(/^https:\/\//i, "wss://")
    .replace(/^http:\/\//i, "ws://");

  return normalizeWsBaseUrl(`${wsCandidate}/ws`) ?? "ws://10.0.2.2:8080/ws";
}

function readAppConfigExtra(): Record<string, unknown> {
  const extra = Constants.expoConfig?.extra;
  return extra && typeof extra === "object" ? (extra as Record<string, unknown>) : {};
}

export function getInjectedNetworkBaseUrls(): NetworkBaseUrls {
  const extra = readAppConfigExtra();

  const port =
    asPort(process.env.EXPO_PUBLIC_SERVER_PORT) ??
    asPort(extra.serverPort) ??
    8080;

  const defaultHttpBaseUrl = `http://10.0.2.2:${port}`;

  const envHttp = normalizeHttpBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
  const appHttp = normalizeHttpBaseUrl(extra.apiBaseUrl ?? extra.httpBaseUrl);
  const httpBaseUrl = envHttp ?? appHttp ?? defaultHttpBaseUrl;

  const envWs = normalizeWsBaseUrl(process.env.EXPO_PUBLIC_WS_BASE_URL);
  const appWs = normalizeWsBaseUrl(extra.wsBaseUrl);
  const wsBaseUrl = envWs ?? appWs ?? toWsUrl(httpBaseUrl);

  const source: NetworkConfigSource =
    envHttp || envWs
      ? "env"
      : appHttp || appWs
        ? "app_config"
        : "default";

  return {
    httpBaseUrl,
    wsBaseUrl,
    source,
  };
}

function normalizeStoredPayload(payload: unknown): NetworkBaseUrls | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const httpBaseUrl = normalizeHttpBaseUrl(record.httpBaseUrl);
  if (!httpBaseUrl) {
    return null;
  }

  const wsBaseUrl = normalizeWsBaseUrl(record.wsBaseUrl) ?? toWsUrl(httpBaseUrl);

  return {
    httpBaseUrl,
    wsBaseUrl,
    source: "storage",
  };
}

export async function loadNetworkBaseUrls(): Promise<NetworkBaseUrls> {
  const injected = getInjectedNetworkBaseUrls();

  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return injected;
    }
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeStoredPayload(parsed);
    return normalized ?? injected;
  } catch {
    return injected;
  }
}

export async function saveNetworkBaseUrls(input: {
  httpBaseUrl: string;
  wsBaseUrl?: string;
}): Promise<NetworkBaseUrls> {
  const httpBaseUrl = normalizeHttpBaseUrl(input.httpBaseUrl);
  if (!httpBaseUrl) {
    throw new Error("HTTP_BASE_URL must be a valid http(s) URL");
  }

  const wsBaseUrl =
    normalizeWsBaseUrl(input.wsBaseUrl) ??
    toWsUrl(httpBaseUrl);

  const next = {
    httpBaseUrl,
    wsBaseUrl,
  };

  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));

  return {
    ...next,
    source: "storage",
  };
}

export async function resetNetworkBaseUrls(): Promise<NetworkBaseUrls> {
  await AsyncStorage.removeItem(STORAGE_KEY);
  return getInjectedNetworkBaseUrls();
}