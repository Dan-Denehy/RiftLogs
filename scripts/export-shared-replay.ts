import { exportSharedReplay } from "./sharedReplayExport.ts";

const argument = process.argv[2];
if (!argument || !/^[1-9]\d*$/.test(argument)) {
  throw new Error("Usage: node scripts/export-shared-replay.ts <capture ID>");
}
const result = exportSharedReplay(Number(argument));
console.log(`Shared replay saved: ${result.output} (${result.bytes} bytes)`);
console.log("Open it with Recorded replays > Open replay file. Original recording untouched.");
