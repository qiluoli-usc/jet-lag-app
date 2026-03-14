import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");
const DEFAULT_DB_PATH = join(PROJECT_ROOT, "data", "jetlag.db");

const DB_PATH = process.env.DB_PATH ?? DEFAULT_DB_PATH;

// Ensure data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Schema migrations ──────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT,
    config TEXT NOT NULL DEFAULT '{}',
    state TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS room_events (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id),
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    actor_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'public',
    data TEXT NOT NULL DEFAULT '{}',
    hash TEXT NOT NULL,
    previous_hash TEXT NOT NULL,
    ts TEXT NOT NULL,
    UNIQUE(room_id, seq)
  );

  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    room_id TEXT NOT NULL REFERENCES rooms(id),
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'seeker',
    joined_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS push_tokens (
    player_id TEXT NOT NULL,
    token TEXT NOT NULL,
    platform TEXT DEFAULT 'unknown',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (player_id, token)
  );

  CREATE INDEX IF NOT EXISTS idx_room_events_room_id ON room_events(room_id, seq);
  CREATE INDEX IF NOT EXISTS idx_players_room_id ON players(room_id);
  CREATE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name);
`);

export default db;
export { DB_PATH };
