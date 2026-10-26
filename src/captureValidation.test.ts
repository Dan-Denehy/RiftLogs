import { expect, it } from "vitest";
import { readAtlasCapture, validAtlasCapture, validBoardObservation, MAX_CAPTURE_BYTES } from "./captureValidation";
import { safeArtworkUrl } from "./artworkPolicy";

const capture = (actions: unknown[]) => ({ format: "riftlogs-atlas-dom-capture", formatVersion: 1, turns: [{ actions }] });
it("validates stored board records before replay construction", () => {
  const observation = { source: "riftatlas-board", formatVersion: 1, sequence: 1, capturedAt: "now", metadata: {}, sections: ["cards"], logs: [],
    state: { context: { turn: null, activePlayerId: null }, players: {}, scores: {}, resources: {}, cards: null } };
  expect(validBoardObservation(observation)).toBe(true);
  expect(validBoardObservation({ ...observation, logs: [null] })).toBe(false);
  expect(validBoardObservation({ ...observation, state: { ...observation.state, cards: [{}] } })).toBe(false);
  expect(validBoardObservation({ ...observation, state: { ...observation.state, players: { plr_a: {} } } })).toBe(false);
});
it("rejects malformed turn/action fields and nested collection members", () => {
  for (const bad of [null, 4, { text: {} }, { cards: [null] }, { cards: [{ name: 4 }] },
    { attributes: { x: {} } }, { observedScores: [{ score: -1 }] }, { sequence: 1.5 }, { captureSequence: 1e100 },
    { actorResolution: "guessed" }, { battlefieldMarkers: [1] }, { observedTrashCards: ["x"] }]) {
    expect(validAtlasCapture(capture([bad]))).toBe(false);
  }
  expect(validAtlasCapture({ ...capture([]), turns: [null, 123] })).toBe(false);
  expect(validAtlasCapture({ ...capture([]), formatVersion: 99 })).toBe(false);
});
it("bounds bytes, turns, actions, nesting and prototype-sensitive keys", () => {
  expect(() => readAtlasCapture(" ".repeat(MAX_CAPTURE_BYTES + 1))).toThrow("10 MiB");
  expect(validAtlasCapture({ ...capture([]), turns: Array.from({ length: 501 }, () => ({ actions: [] })) })).toBe(false);
  expect(validAtlasCapture(capture(Array.from({ length: 2001 }, () => ({ text: "Draw" }))))).toBe(false);
  const deep: Record<string, unknown> = {}; let cursor = deep;
  for (let i = 0; i < 25; i++) { const next = {}; cursor.next = next; cursor = next; }
  expect(validAtlasCapture({ ...capture([]), extra: deep })).toBe(false);
  expect(validAtlasCapture(JSON.parse('{"source":"riftatlas-dom","turns":[],"__proto__":{}}'))).toBe(false);
});
it("accepts both supported capture formats without changing repeated actions or raw HTML", () => {
  const modern = capture([{ text: "Draw", cards: [] }, { text: "Draw" }]);
  expect(readAtlasCapture(JSON.stringify(modern))).toEqual(modern);
  const legacy = { source: "riftatlas-dom", turns: [{ turnNumber: "1", html: '<li onclick="bad()">Draw</li>' }] };
  expect(readAtlasCapture(JSON.stringify(legacy))).toEqual(legacy); // Evidence, not executable UI.
});
it("allows only credential-free RiftAtlas HTTPS artwork on the standard port", () => {
  expect(safeArtworkUrl("https://assets.riftatlas-workers.com/cdn-cgi/image/width=192/riftbound/cards/a.webp?v=1")).not.toBeNull();
  for (const url of ["http://assets.riftatlas-workers.com/a", "https://evil.example/a", "https://assets.riftatlas-workers.com.evil.example/a",
    "https://evil.example@assets.riftatlas-workers.com/a", "https://assets.riftatlas-workers.com:8443/a", "https://127.0.0.1/a",
    "//assets.riftatlas-workers.com/a", "file:///C:/secret", "data:image/svg+xml,test", "javascript:alert(1)"]) expect(safeArtworkUrl(url)).toBeNull();
});
