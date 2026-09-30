import { sql } from "drizzle-orm";
import {
  check,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const players = sqliteTable("players", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  displayName: text("display_name").notNull(),
  normalizedName: text("normalized_name").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// Callers supply a trimmed, lowercase normalizedName for name matching.
export const cards = sqliteTable("cards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull().unique(),
  category: text("category").notNull().default("unknown"),
});

export const rawAtlasCaptures = sqliteTable("raw_atlas_captures", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filename: text("filename").notNull(),
  rawJson: text("raw_json").notNull(),
  importedAt: integer("imported_at", { mode: "timestamp_ms" }).notNull(),
});

export const liveAtlasCaptures = sqliteTable("live_atlas_captures", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: text("room_id").notNull(),
  sourceUrl: text("source_url").notNull(),
  status: text("status").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  eventCount: integer("event_count").notNull().default(0),
});

// The first normalization path uses live captures; recording times stay on the capture.
export const matches = sqliteTable("matches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  captureId: integer("capture_id").notNull().unique().references(() => liveAtlasCaptures.id),
  openingCaptured: integer("opening_captured", { mode: "boolean" }).notNull().default(false),
  endingCaptured: integer("ending_captured", { mode: "boolean" }).notNull().default(false),
  normalizationVersion: integer("normalization_version").notNull().default(1),
}, (table) => [
  check("matches_opening_boolean", sql`${table.openingCaptured} IN (0, 1)`),
  check("matches_ending_boolean", sql`${table.endingCaptured} IN (0, 1)`),
  check("matches_version_positive", sql`${table.normalizationVersion} > 0`),
]);

export const matchPlayers = sqliteTable("match_players", {
  matchId: integer("match_id").notNull().references(() => matches.id),
  playerId: integer("player_id").notNull().references(() => players.id),
  finalScore: integer("final_score"),
  result: text("result", { enum: ["unknown", "win", "loss", "draw"] }).notNull().default("unknown"),
}, (table) => [
  primaryKey({ columns: [table.matchId, table.playerId] }),
  check("match_players_score_nonnegative", sql`${table.finalScore} >= 0`),
  check("match_players_result_valid", sql`${table.result} IN ('unknown', 'win', 'loss', 'draw')`),
]);

export const liveAtlasEvents = sqliteTable(
  "live_atlas_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    captureId: integer("capture_id")
      .notNull()
      .references(() => liveAtlasCaptures.id),
    captureSequence: integer("capture_sequence").notNull(),
    capturedAt: integer("captured_at", { mode: "timestamp_ms" }).notNull(),
    rawJson: text("raw_json").notNull(),
  },
  (table) => [
    uniqueIndex("live_atlas_events_capture_sequence_unique").on(
      table.captureId,
      table.captureSequence,
    ),
  ],
);

// Evidence only: Atlas IDs are not assumed to identify a permanent account.
export const boardObservations = sqliteTable("board_observations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  captureId: integer("capture_id").notNull().references(() => liveAtlasCaptures.id),
  sequence: integer("sequence").notNull(),
  rawJson: text("raw_json").notNull(),
}, (table) => [uniqueIndex("board_observations_capture_sequence_unique").on(table.captureId, table.sequence)]);

export const playerIdObservations = sqliteTable("player_id_observations", {
  rawEventId: integer("raw_event_id").primaryKey().references(() => liveAtlasEvents.id),
  matchId: integer("match_id").notNull().references(() => matches.id),
  playerId: integer("player_id").notNull().references(() => players.id),
  atlasPlayerId: text("atlas_player_id").notNull(),
  observedName: text("observed_name").notNull(),
});

export const hiddenCardReveals = sqliteTable(
  "hidden_card_reveals",
  {
    captureId: integer("capture_id")
      .notNull()
      .references(() => liveAtlasCaptures.id),
    actionSequence: integer("action_sequence").notNull(),
    hiddenCardId: text("hidden_card_id").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.captureId, table.actionSequence] })],
);
