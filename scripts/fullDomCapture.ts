import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";

// Runs in the browser. Keep this function self-contained for Playwright serialization.
export function observeFullDom() {
  if (window !== window.top) return;
  const report = (window as unknown as {
    reportFullDom: (data: unknown) => Promise<void>;
  }).reportFullDom;
  let pending = Promise.resolve();
  const send = (data: Record<string, unknown>) => {
    const event = { ...data, capturedAt: new Date().toISOString(), url: location.href };
    pending = pending.then(() => report(event));
    // Make persistence failures visible instead of silently dropping captured data.
    void pending.catch((error) => console.error("Full DOM capture failed", error));
  };
  const markup = (node: Node) => node instanceof Element ? node.outerHTML : node.textContent;
  const start = () => {
    let lastSnapshot = "";
    const snapshot = (force = false) => {
      const html = document.documentElement.outerHTML;
      if (force || html !== lastSnapshot) {
        lastSnapshot = html;
        send({ kind: "snapshot", title: document.title, html });
      }
    };
    snapshot(true);
    const observer = new MutationObserver((mutations) => {
      send({ kind: "mutations", changes: mutations.map((mutation) => ({
        type: mutation.type,
        target: markup(mutation.target),
        attributeName: mutation.attributeName,
        oldValue: mutation.oldValue,
        added: Array.from(mutation.addedNodes, markup),
        removed: Array.from(mutation.removedNodes, markup),
      })) });
    });
    observer.observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, attributeOldValue: true,
      characterData: true, characterDataOldValue: true,
    });
    // Periodic full snapshots give context to the intervening mutation records.
    const timer = window.setInterval(() => snapshot(), 1000);
    (window as unknown as { stopFullDom: () => Promise<void> }).stopFullDom = async () => {
      clearInterval(timer);
      observer.disconnect();
      snapshot(true);
      await pending;
    };
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

export async function startFullDomCapture(page: Page, roomId: string) {
  const directory = path.resolve("logs/full-log-capture");
  mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, `full-log-capture-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  writeFileSync(filename, "", { flag: "wx" });
  let sequence = 0;
  const write = (data: unknown) => appendFileSync(filename, JSON.stringify({
    sequence: sequence++, receivedAt: new Date().toISOString(), data,
  }) + "\n");
  write({ kind: "start", format: "riftlogs-full-dom", formatVersion: 1, roomId });
  await page.exposeBinding("reportFullDom", (_source, data: unknown) => write(data));
  await page.addInitScript(observeFullDom);
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) write({ kind: "navigation", url: frame.url() });
  });
  return {
    filename,
    async flush() {
      if (!page.isClosed()) await page.evaluate(async () => {
        await (window as unknown as { stopFullDom?: () => Promise<void> }).stopFullDom?.();
      });
    },
    finish() { write({ kind: "stop" }); },
  };
}
