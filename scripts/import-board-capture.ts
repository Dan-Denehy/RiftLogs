import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
// @ts-expect-error jsdom declarations are not installed.
import { JSDOM } from "jsdom";
import { captureBoardState, type CompactObservation } from "../src/boardObservation.ts";
import { compactDelta, buildRecordedReplay } from "../src/recordedReplay.ts";
import { createDatabase } from "../server/database.ts";
import { saveObservation } from "../server/boardObservationStore.ts";
import { LiveCaptureRecorder } from "../server/liveCaptureStore.ts";

const filename = process.argv[2];
if (!filename) throw new Error("Usage: npm.cmd run import:board -- <full-capture.jsonl> [--sample-index <snapshot-index.jsonl>]");
const indexArgument = process.argv.indexOf("--sample-index");
const indexFile = indexArgument >= 0 ? process.argv[indexArgument + 1] : undefined;
if (indexArgument >= 0 && !indexFile) throw new Error("--sample-index needs a filename.");
fs.accessSync(filename, fs.constants.R_OK);
const database = createDatabase();
const recorder = LiveCaptureRecorder.start(database.db, { roomId: indexFile ? "DOM replay (sampled)" : "DOM replay", sourceUrl: path.resolve(filename) });
const observations: CompactObservation[] = [];
let previous: CompactObservation | undefined;
let snapshots = 0;
async function consume(line: string) {
  const record = JSON.parse(line);
  if (record.data?.kind !== "snapshot" || typeof record.data.html !== "string") return;
  snapshots++;
  const window = new JSDOM(record.data.html, { url: record.data.url ?? "https://play.riftatlas.com/game" }).window;
  try {
    const full = captureBoardState(window.document, observations.length + 1, record.data.capturedAt ?? record.receivedAt);
    if (!full.metadata.room) return;
    full.sourceSequence = record.sequence;
    const compact = compactDelta(previous, full);
    if (compact) {
      if (indexFile) compact.reason = `${compact.reason}; sampled-source`;
      saveObservation(database.db, recorder.captureId, compact);
      observations.push(compact);
    }
    previous = full;
    if (snapshots % 25 === 0) console.log(`Read ${snapshots} snapshots; saved ${observations.length} compact observations.`);
  } finally { window.close(); }
}
try {
  if (indexFile) {
    // Explicit research mode: indexed snapshots are samples, NOT a complete event capture.
    const index = fs.readFileSync(indexFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    for (const entry of index) {
      const input = fs.createReadStream(filename, { start: entry.byteOffset });
      try { for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) { await consume(line); break; } }
      finally { input.destroy(); }
    }
  } else {
    const input = fs.createReadStream(filename);
    try { for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) await consume(line); }
    finally { input.destroy(); }
  }
  if (!observations.length) throw new Error("No RiftAtlas board snapshots found. Capture retained for diagnosis.");
  recorder.complete();
  const games = buildRecordedReplay(observations);
  console.log(JSON.stringify({ captureId: recorder.captureId, originalUnchanged: path.resolve(filename), snapshots,
    observations: observations.length, sampled: !!indexFile,
    games: games.map((game) => ({ number: game.number, room: game.room, steps: game.steps.length, warnings: game.warnings.length })) }, null, 2));
} finally { database.close(); }
