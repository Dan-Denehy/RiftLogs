import { asc, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "./database.ts";
import { LiveCaptureRecorder } from "./liveCaptureStore.ts";
import { liveAtlasCaptures, liveAtlasEvents } from "./schema.ts";

let database: ReturnType<typeof createDatabase> | undefined;

afterEach(() => database?.close());

describe("LiveCaptureRecorder", () => {
  it("keeps repeated identical raw events as separate ordered rows", () => {
    database = createDatabase(":memory:");
    const recorder = LiveCaptureRecorder.start(database.db, {
      roomId: "room-123",
      sourceUrl: "https://play.riftatlas.com/game",
    });
    const repeatedEvent = {
      capturedAt: "2026-08-26T12:00:00.000Z",
      action: { text: "Drew a card", outerHTML: "<li>Draw</li>" },
    };

    recorder.append([repeatedEvent, repeatedEvent]);
    recorder.complete();

    const events = database.db
      .select()
      .from(liveAtlasEvents)
      .where(eq(liveAtlasEvents.captureId, recorder.captureId))
      .orderBy(asc(liveAtlasEvents.captureSequence))
      .all();
    const capture = database.db
      .select()
      .from(liveAtlasCaptures)
      .where(eq(liveAtlasCaptures.id, recorder.captureId))
      .get();

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.captureSequence)).toEqual([1, 2]);
    expect(events[0].rawJson).toBe(events[1].rawJson);
    expect(capture).toMatchObject({ status: "complete", eventCount: 2 });
  });
});
