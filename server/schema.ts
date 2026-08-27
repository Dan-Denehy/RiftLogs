import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
