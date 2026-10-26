import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { validBoardObservation } from "../src/captureValidation.ts";
import { buildRecordedReplay } from "../src/recordedReplay.ts";

// Read-only export: the recording and its original raw event HTML stay in SQLite.
export function exportSharedReplay(captureId: number, databaseFilename = "riftlogs.db", outputDirectory = "exports") {
if (!Number.isSafeInteger(captureId) || captureId < 1) throw new Error("Invalid capture ID.");
const database = new Database(databaseFilename, { readonly: true });
try {
  const rows = database.prepare(
    "SELECT raw_json FROM board_observations WHERE capture_id = ? ORDER BY sequence, id",
  ).all(captureId) as { raw_json: string }[];
  if (!rows.length) throw new Error(`Capture #${captureId} has no board observations.`);
  if (rows.length > 2000) throw new Error("Shared replay exceeds 2,000 observations.");
  const original = rows.map((row) => {
    const value: unknown = JSON.parse(row.raw_json);
    if (!validBoardObservation(value)) throw new Error("Invalid board observation; export stopped.");
    return value;
  });
  const observations = original.map((observation) => ({
    ...observation,
    // Page URLs are unnecessary for playback and may contain private query parameters.
    metadata: { ...observation.metadata, url: "" },
  }));
  const shared = {
    format: "riftlogs-shared-replay",
    formatVersion: 1,
    captureId,
    observations,
  };
  const json = JSON.stringify(shared);
  if (Buffer.byteLength(json) > 64 * 1024 * 1024) throw new Error("Shared replay exceeds 64 MiB expanded.");
  const compressed = gzipSync(json, { level: 9 });
  if (compressed.length > 10 * 1024 * 1024) throw new Error("Shared replay exceeds 10 MiB compressed.");
  const restored = JSON.parse(gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 }).toString("utf8"));
  assert.deepStrictEqual(restored, shared);
  // Check every reconstructed step, including rewind flags, artwork, and board state.
  assert.deepStrictEqual(buildRecordedReplay(restored.observations), buildRecordedReplay(original));
  const directory = resolve(outputDirectory);
  mkdirSync(directory, { recursive: true });
  const output = resolve(directory, `capture-${captureId}.riftlogs-replay.json.gz`);
  // Refuse to overwrite a previous export.
  writeFileSync(output, compressed, { flag: "wx" });
  return { output, bytes: compressed.length, observationCount: observations.length };
} finally {
  database.close();
}
}
