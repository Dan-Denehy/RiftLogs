import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

export function createDatabase(filename = "riftlogs.db") {
  const sqlite = new Database(filename);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'unknown'
    );

    CREATE TABLE IF NOT EXISTS raw_atlas_captures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      imported_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS live_atlas_captures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      event_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capture_id INTEGER NOT NULL UNIQUE REFERENCES live_atlas_captures(id),
      opening_captured INTEGER NOT NULL DEFAULT 0 CHECK (opening_captured IN (0, 1)),
      ending_captured INTEGER NOT NULL DEFAULT 0 CHECK (ending_captured IN (0, 1)),
      normalization_version INTEGER NOT NULL DEFAULT 1 CHECK (normalization_version > 0)
    );

    CREATE TABLE IF NOT EXISTS match_players (
      match_id INTEGER NOT NULL REFERENCES matches(id),
      player_id INTEGER NOT NULL REFERENCES players(id),
      final_score INTEGER CHECK (final_score >= 0),
      result TEXT NOT NULL DEFAULT 'unknown' CHECK (result IN ('unknown', 'win', 'loss', 'draw')),
      PRIMARY KEY (match_id, player_id)
    );

    CREATE TABLE IF NOT EXISTS live_atlas_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capture_id INTEGER NOT NULL REFERENCES live_atlas_captures(id),
      capture_sequence INTEGER NOT NULL,
      captured_at INTEGER NOT NULL,
      raw_json TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS live_atlas_events_capture_sequence_unique
      ON live_atlas_events(capture_id, capture_sequence);

    CREATE TABLE IF NOT EXISTS hidden_card_reveals (
      capture_id INTEGER NOT NULL REFERENCES live_atlas_captures(id),
      action_sequence INTEGER NOT NULL,
      hidden_card_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (capture_id, action_sequence)
    );
  `);

  return {
    db: drizzle(sqlite),
    close: () => sqlite.close(),
  };
}
