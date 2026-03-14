import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Role } from "../types";

const PREFIX = "jetlag.mobile.room.player.v1:";

export interface PlayerSession {
  roomCode: string;
  playerId: string;
  playerName: string;
  role: Role;
}

function normalizeRoomCode(roomCode: string): string {
  return String(roomCode).trim().toUpperCase();
}

function keyFor(roomCode: string): string {
  return `${PREFIX}${normalizeRoomCode(roomCode)}`;
}

function isRole(value: unknown): value is Role {
  return value === "hider" || value === "seeker" || value === "observer";
}

export async function getPlayerSession(roomCode: string): Promise<PlayerSession | null> {
  const normalizedCode = normalizeRoomCode(roomCode);
  if (!normalizedCode) {
    return null;
  }

  try {
    const raw = await AsyncStorage.getItem(keyFor(normalizedCode));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PlayerSession>;
    if (
      typeof parsed.roomCode !== "string" ||
      typeof parsed.playerId !== "string" ||
      typeof parsed.playerName !== "string" ||
      !isRole(parsed.role)
    ) {
      return null;
    }

    return {
      roomCode: normalizeRoomCode(parsed.roomCode),
      playerId: parsed.playerId,
      playerName: parsed.playerName,
      role: parsed.role,
    };
  } catch {
    return null;
  }
}

export async function savePlayerSession(session: PlayerSession): Promise<void> {
  const normalized: PlayerSession = {
    roomCode: normalizeRoomCode(session.roomCode),
    playerId: String(session.playerId),
    playerName: String(session.playerName),
    role: session.role,
  };
  await AsyncStorage.setItem(keyFor(normalized.roomCode), JSON.stringify(normalized));
}

export async function clearPlayerSession(roomCode: string): Promise<void> {
  const normalizedCode = normalizeRoomCode(roomCode);
  if (!normalizedCode) {
    return;
  }
  await AsyncStorage.removeItem(keyFor(normalizedCode));
}

export async function clearAllPlayerSessions(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const sessionKeys = keys.filter((item) => item.startsWith(PREFIX));
  if (sessionKeys.length === 0) {
    return;
  }
  await AsyncStorage.multiRemove(sessionKeys);
}
