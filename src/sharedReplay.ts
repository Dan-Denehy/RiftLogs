import { validBoardObservation } from "./captureValidation.ts";
import { buildRecordedReplay } from "./recordedReplay.ts";

export const MAX_SHARED_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_SHARED_JSON_BYTES = 64 * 1024 * 1024;

// Local playback only: never uploads or changes the selected file.
export async function openSharedReplay(file: Blob) {
  if (file.size > MAX_SHARED_FILE_BYTES) throw new Error("Replay file exceeds 10 MiB.");
  const signature = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const compressed = signature[0] === 0x1f && signature[1] === 0x8b;
  const stream = compressed ? file.stream().pipeThrough(new DecompressionStream("gzip")) : file.stream();
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_SHARED_JSON_BYTES) throw new Error("Expanded replay exceeds 64 MiB.");
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const data = JSON.parse(parts.join(""));
  if (!data || data.format !== "riftlogs-shared-replay" || data.formatVersion !== 1 ||
      !Array.isArray(data.observations) || !data.observations.length || data.observations.length > 2000 ||
      !data.observations.every(validBoardObservation)) {
    throw new Error("Invalid shared replay: expected version 1 and 1–2,000 valid board observations.");
  }
  const games = buildRecordedReplay(data.observations);
  if (!games.length) throw new Error("This file contains no playable games.");
  return games;
}
