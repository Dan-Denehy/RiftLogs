import { expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { openSharedReplay, MAX_SHARED_FILE_BYTES, MAX_SHARED_JSON_BYTES } from "./sharedReplay.ts";
import { buildRecordedReplay } from "./recordedReplay.ts";
import type { CompactObservation } from "./boardObservation.ts";

const observation: CompactObservation = {
  formatVersion: 1, source: "riftatlas-board", sequence: 1, capturedAt: "2026-10-26",
  sections: ["context", "cards"], cardScope: "visible-only",
  metadata: { room: "TEST", phase: "in_game", resetToken: null, authoritativeSequence: 1, url: "" },
  logs: [1, 2].map(() => ({ key: "draw", text: "Draw", turn: 1 })),
  state: { context: { turn: 1, activePlayerId: "a" }, players: { a: "Player" }, scores: {}, resources: {}, cards: [] },
};
const data = { format: "riftlogs-shared-replay", formatVersion: 1, observations: [observation] };
const zipped = (text: string) => new Blob([new Uint8Array(gzipSync(text))]);

it("opens JSON and gzip with identical playback and repeated actions intact", async () => {
  for (const file of [new Blob([JSON.stringify(data)]), zipped(JSON.stringify(data))]) {
    const games = await openSharedReplay(file);
    expect(games).toEqual(buildRecordedReplay([observation]));
    expect(games[0].steps.filter((step) => step.action.text === "Draw")).toHaveLength(2);
  }
});
it("rejects wrong formats, versions, empty recordings, and invalid observations", async () => {
  for (const invalid of [null, {}, { ...data, formatVersion: 2 }, { ...data, observations: [] },
    { ...data, observations: [{}] }, { ...data, observations: Array(2001).fill(observation) }]) {
    await expect(openSharedReplay(new Blob([JSON.stringify(invalid)]))).rejects.toThrow("Invalid shared replay");
  }
});
it("rejects corrupt JSON and gzip", async () => {
  await expect(openSharedReplay(new Blob(["not json"]))).rejects.toThrow();
  await expect(openSharedReplay(new Blob([new Uint8Array([31, 139, 1, 2])]))).rejects.toThrow();
});
it("rejects oversized files before reading", async () => {
  await expect(openSharedReplay(new Blob([new Uint8Array(MAX_SHARED_FILE_BYTES + 1)]))).rejects.toThrow("10 MiB");
});
it("bounds gzip expansion", async () => {
  await expect(openSharedReplay(zipped(" ".repeat(MAX_SHARED_JSON_BYTES + 1)))).rejects.toThrow("64 MiB");
});
