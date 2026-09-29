import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createHash } from "node:crypto";
// @ts-expect-error jsdom has no declarations installed; use DOM types for the document below.
import { JSDOM } from "jsdom";

const filename = process.argv[2];
if (!filename) throw new Error("Provide the research copy filename.");
const directory = path.dirname(filename);
const output = path.join(directory, "snapshot-index.jsonl");
fs.writeFileSync(output, "");
let offset = 0, count = 0, lastSample = 0, sampled = 0;
const hash = createHash("sha256");
const input = fs.createReadStream(filename);
input.on("data", (chunk) => hash.update(chunk));
for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
  const byteOffset = offset;
  offset += Buffer.byteLength(line) + 1;
  count++;
  const row = JSON.parse(line);
  const data = row.data;
  const time = Date.parse(row.receivedAt);
  if (data.kind !== "snapshot" || time - lastSample < 15000) continue;
  lastSample = time;
  const window = new JSDOM(data.html).window;
  const doc: Document = window.document;
  doc.querySelectorAll("script,style,noscript,svg").forEach((node) => node.remove());
  const text = (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
  const labels = [...doc.querySelectorAll("[aria-label]")].map((node) => node.getAttribute("aria-label"))
    .filter((label) => label && /score|point|game|match|win|lumi|rek|series/i.test(label));
  const turns = [...doc.querySelectorAll('[data-match-log-turn-divider="true"]')].map((node) => node.textContent);
  const cards = [...new Set([...doc.querySelectorAll("img[alt]")].map((node) => node.getAttribute("alt")))];
  const item = { sequence: row.sequence, line: count, byteOffset, receivedAt: row.receivedAt,
    url: data.url?.split("?")[0], labels, turns, cards, text };
  fs.appendFileSync(output, JSON.stringify(item) + "\n");
  window.close();
  if (++sampled % 30 === 0) console.log(`Indexed ${sampled} snapshots through ${row.receivedAt}`);
}
const summary = { records: count, sampled, bytes: offset, sha256: hash.digest("hex") };
fs.writeFileSync(path.join(directory, "skim-summary.json"), JSON.stringify(summary, null, 2));
console.log(summary);
