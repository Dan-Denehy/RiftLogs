import { expect, it } from "vitest";
import { createDatabase } from "./database.ts";
import { LiveCaptureRecorder } from "./liveCaptureStore.ts";
import { saveObservation } from "./boardObservationStore.ts";
import { boardObservations } from "./schema.ts";
import { sampleEntries } from "../src/sampleReplay.ts";

it("preserves original observations and rejects conflicting retries", () => {
  const database = createDatabase(":memory:");
  try {
    const capture = LiveCaptureRecorder.start(database.db, { roomId: "TEST", sourceUrl: "https://example.test" });
    const observation = sampleEntries[0].observation!;
    const id = saveObservation(database.db, capture.captureId, observation);
    expect(saveObservation(database.db, capture.captureId, observation)).toBe(id);
    const changed = structuredClone(observation);
    changed.state.scores.p1 = 8;
    expect(() => saveObservation(database.db, capture.captureId, changed)).toThrow(/Cannot overwrite/);
    expect(database.db.select().from(boardObservations).all()).toEqual([
      expect.objectContaining({ rawJson: JSON.stringify(observation) }),
    ]);
  } finally { database.close(); }
});
