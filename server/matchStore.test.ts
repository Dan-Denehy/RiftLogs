import { afterEach, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "./database.ts";
import { LiveCaptureRecorder } from "./liveCaptureStore.ts";
import { normalizeLiveMatch } from "./matchStore.ts";
import { liveAtlasEvents, matches, matchPlayers, players } from "./schema.ts";

let database: ReturnType<typeof createDatabase>;
beforeEach(() => { database = createDatabase(":memory:"); });
afterEach(() => database.close());

function recording(names: string[], text = "Ended their turn.") {
  const recorder = LiveCaptureRecorder.start(database.db, { roomId: "TEST", sourceUrl: "https://example.test" });
  recorder.append(names.map((name) => ({
    format: "riftlogs-atlas-live-event", capturedAt: new Date().toISOString(),
    turn: { turnPlayerName: name }, action: { text },
  })));
  return recorder;
}

it("reuses match/player IDs, preserves raw events and existing results", () => {
  const recorder = recording([" Lumi ", "LUMI", "AtherVee"], "Finalized mulligan.");
  const raw = database.db.select().from(liveAtlasEvents).all();
  const first = normalizeLiveMatch(database.db, recorder.captureId);
  expect(first.openingCaptured).toBe(true);
  expect(first.participants).toHaveLength(2);
  expect(first.participants.map((p) => p.result)).toEqual(["unknown", "unknown"]);
  database.db.update(matchPlayers).set({ result: "win", finalScore: 8 })
    .where(eq(matchPlayers.playerId, first.participants[0].playerId)).run();
  const second = normalizeLiveMatch(database.db, recorder.captureId);
  expect(second.id).toBe(first.id);
  expect(second.participants[0]).toMatchObject({ playerId: first.participants[0].playerId, result: "win", finalScore: 8 });
  expect(database.db.select().from(matches).all()).toHaveLength(1);
  expect(database.db.select().from(players).all()).toHaveLength(2);
  expect(database.db.select().from(liveAtlasEvents).all()).toEqual(raw);
});

it("reuses players across matches and leaves generic identities unresolved", () => {
  const first = normalizeLiveMatch(database.db, recording(["Lumi", "Opponent"]).captureId);
  const recorder = recording(["lumi", "self", "", "unknown"]);
  recorder.complete();
  const second = normalizeLiveMatch(database.db, recorder.captureId);
  expect(second.id).not.toBe(first.id);
  expect(second.participants).toHaveLength(1);
  expect(second.participants[0].playerId).toBe(first.participants[0].playerId);
  expect(second).toMatchObject({ openingCaptured: false, endingCaptured: false });
  expect(second.participants[0]).toMatchObject({ result: "unknown", finalScore: null });
});

it("refreshes a growing recording without duplicating participants", () => {
  const recorder = recording(["Lumi"]);
  normalizeLiveMatch(database.db, recorder.captureId);
  recorder.append([{ capturedAt: new Date().toISOString(), turn: { turnPlayerName: "AtherVee" }, action: { text: "Selected battlefields." } }]);
  const updated = normalizeLiveMatch(database.db, recorder.captureId);
  expect(updated.openingCaptured).toBe(true);
  expect(updated.participants).toHaveLength(2);
});
