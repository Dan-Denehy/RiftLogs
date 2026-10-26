import assert from "node:assert/strict";
import { chromium } from "playwright";
import { waitForRecordingStop } from "./recordingStop.ts";
import { startCompactBoardCapture } from "./compactBoardCapture.ts";
import type { CompactObservation } from "../src/boardObservation.ts";

// Local fixture only: no Atlas login, network requests, or production database writes.
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent('<main data-viewer-player-id="plr_a" data-viewer-score="0"><span data-room-code="TEST"></span></main>');
  const observations: CompactObservation[] = [];
  const capture = await startCompactBoardCapture(page, (observation) => observations.push(observation));
  await capture.flush();
  await page.locator("main").evaluate((element) => element.setAttribute("data-viewer-score", "2"));
  const stopped = waitForRecordingStop(page, context, () => capture.flush(true));
  process.stdin.emit("data", Buffer.from("stop\n"));
  assert.equal(await stopped, true);
  assert.equal(observations.at(-1)?.state.scores.plr_a, 2);
  assert.equal(page.isClosed(), true);

  const interruptedContext = await browser.newContext();
  const interruptedPage = await interruptedContext.newPage();
  let flushed = false;
  const interrupted = waitForRecordingStop(interruptedPage, interruptedContext, async () => { flushed = true; });
  await interruptedPage.close();
  assert.equal(await interrupted, false);
  assert.equal(flushed, false);
  console.log("stop + Enter saved the pending board change before closing; early browser close was interrupted.");
} finally { await browser.close(); }
