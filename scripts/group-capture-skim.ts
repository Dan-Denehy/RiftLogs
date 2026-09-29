import fs from "node:fs";
import path from "node:path";

const directory = process.argv[2];
if (!directory) throw new Error("Provide the skim directory.");
const rows = fs.readFileSync(path.join(directory, "snapshot-index.jsonl"), "utf8")
  .trim().split("\n").map((line) => JSON.parse(line));
const groups: Record<string, typeof rows> = {};
for (const row of rows) {
  const game = row.text.match(/Game ([123])/i)?.[1] ?? "unknown";
  (groups[`game-${game}`] ??= []).push(row);
}
for (const [name, items] of Object.entries(groups)) {
  fs.writeFileSync(path.join(directory, `${name}-skim.jsonl`), items.map((row) => JSON.stringify(row)).join("\n") + "\n");
}
const signals = {
  boundaries: Object.entries(groups).map(([group, items]) => ({ group, first: items[0], last: items.at(-1) })),
  setup: rows.filter((row) => /sideboarding|mulligan|Both battlefields are locked/i.test(row.text)),
  winnerCandidates: rows.filter((row) => /winner|victory|defeat|conced|surrender|Score: [0-9]+ → 8|\bgg\b/i.test(row.text)),
  identity: rows.filter((row) => row.cards.some((name: string) => /Rek'Sai|Irelia/.test(name))).slice(0, 2),
};
fs.writeFileSync(path.join(directory, "grouped-signals.json"), JSON.stringify(signals, null, 2));
console.log(Object.entries(groups).map(([name, items]) => ({ name, samples: items.length, firstSequence: items[0].sequence, lastSequence: items.at(-1).sequence })));
