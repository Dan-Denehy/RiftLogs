import type { Page } from "playwright";
import { captureBoardState, type CompactObservation } from "../src/boardObservation.ts";
import { compactDelta } from "../src/recordedReplay.ts";

// Runs inside the spectator browser. Mutations are throttled (not endlessly debounced).
export function observeCompactBoard() {
  if (window !== window.top) return;
  const host = window as unknown as {
    readRiftLogsBoard: typeof captureBoardState;
    saveRiftLogsBoard: (observation: CompactObservation) => Promise<void>;
    flushRiftLogsBoard?: () => Promise<void>;
    stopRiftLogsBoard?: () => Promise<void>;
  };
  if (host.flushRiftLogsBoard) return;
  let pending = Promise.resolve();
  let timer: number | undefined;
  const scan = () => {
    window.clearTimeout(timer); timer = undefined;
    if (!document.querySelector("[data-viewer-player-id]")) return pending;
    const observation = host.readRiftLogsBoard(document, 0, new Date().toISOString());
    pending = pending.then(() => host.saveRiftLogsBoard(observation));
    void pending.catch((error) => console.error("Compact board save failed", error));
    return pending;
  };
  const schedule = () => { timer ??= window.setTimeout(() => void scan(), 60); };
  const observer = new MutationObserver(schedule);
  observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ["data-card-id", "data-drop-zone", "data-visual-owner", "data-zone-owner", "data-exhausted", "data-face-down",
      "data-turn-number", "data-active-player-id", "data-viewer-player-id", "data-opponent-player-id", "data-viewer-score", "data-opponent-score",
      "data-rune-ready-count", "data-rune-used-count", "data-pile-count", "data-room-phase", "data-room-code", "data-authoritative-sequence",
      "data-chain-targeting", "data-chain-entry-id", "data-chain-timeline-entry-id", "data-chain-timeline-position", "data-chain-timeline-owner", "data-chain-timeline-newest",
      "data-authoritative-reset-token", "alt", "data-battlefield-might-zone", "data-battlefield-might-player",
      "data-battlefield-might-value", "data-might-side", "data-battlefield-marker", "aria-label", "title", "src", "srcset", "data-card-art-source"] });
  host.flushRiftLogsBoard = scan;
  host.stopRiftLogsBoard = () => { observer.disconnect(); return scan(); };
  schedule();
}

export async function startCompactBoardCapture(page: Page, save: (observation: CompactObservation) => void) {
  let previous: CompactObservation | undefined;
  let sequence = 0;
  let failure: unknown;
  await page.exposeBinding("saveRiftLogsBoard", (_source, observation: CompactObservation) => {
    if (failure) throw failure;
    const delta = compactDelta(previous, observation);
    if (!delta) return;
    delta.sequence = sequence + 1;
    try { save(delta); } catch (error) { failure = error; console.error("Compact board persistence failed:", error); throw error; }
    sequence++;
    previous = structuredClone(observation);
  });
  // Type annotations disappear when Node loads this TS file. Function bodies have no imports.
  const content = `window.readRiftLogsBoard = ${captureBoardState.toString()}; (${observeCompactBoard.toString()})();`;
  await page.addInitScript({ content });
  await page.evaluate(content);
  return {
    async flush(final = false) {
      if (page.isClosed()) throw new Error("Browser closed before final board save.");
      await page.evaluate(async (final) => {
        const host = window as unknown as { stopRiftLogsBoard?: () => Promise<void>; flushRiftLogsBoard?: () => Promise<void> };
        const save = final ? host.stopRiftLogsBoard : host.flushRiftLogsBoard;
        if (!save) throw new Error("Board collector unavailable during save.");
        await save();
      }, final);
      if (failure) throw failure;
    },
    count: () => sequence,
    failed: () => failure !== undefined,
  };
}
