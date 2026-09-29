import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
// @ts-expect-error jsdom declarations are not installed.
import { JSDOM } from "jsdom";

const directory = process.argv[2];
if (!directory) throw new Error("Provide the review directory.");
const index = fs.readFileSync(path.join(directory, "snapshot-index.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const attributes: Record<string, { count: number; examples: unknown[] }> = {};
const controls = new Map<string, unknown>();
const actionExamples = new Map<string, unknown>();
for (const entry of index) {
  const stream = fs.createReadStream(path.join(directory, "capture-copy.jsonl"), { start: entry.byteOffset });
  for await (const line of readline.createInterface({ input: stream })) {
    const window = new JSDOM(JSON.parse(line).data.html).window;
    const document: Document = window.document;
    const location = { sequence: entry.sequence, byteOffset: entry.byteOffset, time: entry.receivedAt };
    for (const element of document.querySelectorAll("*")) {
      for (const attribute of element.attributes) {
        if (!attribute.name.startsWith("data-") || attribute.name === "data-nimg") continue;
        const item = attributes[attribute.name] ??= { count: 0, examples: [] };
        item.count++;
        if (item.examples.length < 5 && !item.examples.some((example: any) => example.value === attribute.value)) {
          item.examples.push({ ...location, value: attribute.value, tag: element.tagName,
            text: element.textContent?.replace(/\s+/g, " ").slice(0, 300),
            html: element.outerHTML.slice(0, 1800) });
        }
      }
      const label = element.getAttribute("aria-label") ?? element.getAttribute("title");
      if (label && /rune|energy|power|hand|deck|trash|score|phase|turn|legend|champion|game|sideboard|player|profile|reveal|hidden/i.test(label) && !controls.has(label)) {
        controls.set(label, { ...location, label, html: element.outerHTML.slice(0, 1800) });
      }
      if (element.matches("li") && !element.querySelector("li") && element.querySelector('[data-log-action-kind], [data-log-action-placeholder]')) {
        const text = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const kind = element.querySelector('[data-log-action-kind]')?.getAttribute('data-log-action-kind') ?? "placeholder";
        const key = `${kind}:${text.replace(/^\d+:\d+/, '').split(' ').slice(0, 2).join(' ')}`;
        if (!actionExamples.has(key)) actionExamples.set(key, { ...location, kind, text, html: element.outerHTML.slice(0, 2500) });
      }
    }
    window.close();
    stream.destroy();
    break;
  }
}
fs.writeFileSync(path.join(directory, "dom-field-catalog.json"), JSON.stringify({ sampledSnapshots: index.length, attributes, controls: [...controls.values()], actionExamples: [...actionExamples.values()] }, null, 2));
console.log({ sampledSnapshots: index.length, attributeTypes: Object.keys(attributes).length, controls: controls.size, actionExamples: actionExamples.size });
