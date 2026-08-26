import { eq, sql } from "drizzle-orm";
import type { createDatabase } from "./database.ts";
import { liveAtlasCaptures, liveAtlasEvents } from "./schema.ts";

type Database = ReturnType<typeof createDatabase>["db"];

export type RawLiveAtlasEvent = {
  capturedAt?: string;
  [key: string]: unknown;
};

export class LiveCaptureRecorder {
  private nextSequence = 1;
  private readonly database: Database;
  readonly captureId: number;

  private constructor(database: Database, captureId: number) {
    this.database = database;
    this.captureId = captureId;
  }

  static start(
    database: Database,
    details: { roomId: string; sourceUrl: string },
  ) {
    const saved = database
      .insert(liveAtlasCaptures)
      .values({
        roomId: details.roomId,
        sourceUrl: details.sourceUrl,
        status: "recording",
        startedAt: new Date(),
      })
      .returning({ id: liveAtlasCaptures.id })
      .get();

    return new LiveCaptureRecorder(database, saved.id);
  }

  append(events: RawLiveAtlasEvent[]) {
    if (events.length === 0) return [];

    const rows = events.map((event) => ({
      captureId: this.captureId,
      captureSequence: this.nextSequence++,
      capturedAt: dateFrom(event.capturedAt),
      rawJson: JSON.stringify(event),
    }));

    this.database.transaction((transaction) => {
      transaction.insert(liveAtlasEvents).values(rows).run();
      transaction
        .update(liveAtlasCaptures)
        .set({
          eventCount: sql`${liveAtlasCaptures.eventCount} + ${rows.length}`,
        })
        .where(eq(liveAtlasCaptures.id, this.captureId))
        .run();
    });

    return rows.map((row) => row.captureSequence);
  }

  complete() {
    this.database
      .update(liveAtlasCaptures)
      .set({ status: "complete", endedAt: new Date() })
      .where(eq(liveAtlasCaptures.id, this.captureId))
      .run();
  }
}

function dateFrom(value: string | undefined) {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
