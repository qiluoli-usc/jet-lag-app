import type { FrontPhase, RoomEvent } from "../types";

export interface CountdownTarget {
  label: string;
  targetAtMs: number;
}

export function normalizePhase(phase: string | null | undefined): FrontPhase {
  const value = String(phase ?? "").toUpperCase();
  if (value === "HIDE" || value === "HIDING") {
    return "HIDING";
  }
  if (value === "SEEK" || value === "SEEKING") {
    return "SEEKING";
  }
  if (value === "ENDGAME" || value === "END_GAME") {
    return "END_GAME";
  }
  if (value === "CAUGHT") {
    return "CAUGHT";
  }
  if (value === "SUMMARY") {
    return "SUMMARY";
  }
  return "LOBBY";
}

export function phaseLabel(phase: FrontPhase): string {
  switch (phase) {
    case "HIDING":
      return "HIDING";
    case "SEEKING":
      return "SEEKING";
    case "END_GAME":
      return "END GAME";
    case "CAUGHT":
      return "CAUGHT";
    case "SUMMARY":
      return "SUMMARY";
    case "LOBBY":
    default:
      return "LOBBY";
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseIsoMs(value: unknown): number | null {
  const text = asString(value);
  if (!text) {
    return null;
  }
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

export function deriveCountdownTarget(phase: FrontPhase, events: RoomEvent[]): CountdownTarget | null {
  if (phase === "HIDING") {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event.type !== "phase.hide.started") {
        continue;
      }
      const targetMs = parseIsoMs(event.data.hideEndsAt);
      if (!targetMs) {
        continue;
      }
      return {
        label: "Hiding Ends In",
        targetAtMs: targetMs,
      };
    }
    return null;
  }

  if (phase === "SEEKING" || phase === "END_GAME" || phase === "CAUGHT") {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event.type !== "phase.seek.started" && event.type !== "catch.failed.return_to_seek") {
        continue;
      }
      const targetMs = parseIsoMs(event.data.seekEndsAt);
      if (!targetMs) {
        continue;
      }
      return {
        label: "Seek Ends In",
        targetAtMs: targetMs,
      };
    }
  }

  return null;
}

export function formatRemaining(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSec = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
