import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

export function createDatabase(filename = "riftlogs.db") {
  const sqlite = new Database(filename);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(`
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

    CREATE TABLE IF NOT EXISTS live_atlas_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capture_id INTEGER NOT NULL REFERENCES live_atlas_captures(id),
      capture_sequence INTEGER NOT NULL,
      captured_at INTEGER NOT NULL,
      raw_json TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS live_atlas_events_capture_sequence_unique
      ON live_atlas_events(capture_id, capture_sequence);
  `);

  return {
    db: drizzle(sqlite),
    close: () => sqlite.close(),
  };
}
