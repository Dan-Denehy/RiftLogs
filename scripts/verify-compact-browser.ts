import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { startCompactBoardCapture } from "./compactBoardCapture.ts";
import type { CompactObservation } from "../src/boardObservation.ts";

// Opt-in browser integration check. Start `npm.cmd run dev` first.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = `<main data-viewer-player-id="plr_a" data-opponent-player-id="plr_b" data-turn-number="1" data-room-phase="in_game"
    data-authoritative-sequence="1" data-authoritative-reset-token="ABC:1"><span data-room-code="ABC"></span>
    <div data-drop-zone-root="base"><button data-board-card-visual="true" data-visual-owner="self" data-card-id="test-unit"
    data-drop-zone="base" data-face-down="false" data-exhausted="true"><img alt="Scout"></button></div></main>`;
  await page.route("http://riftlogs.test/**", (route) => route.fulfill({ contentType: "text/html", body: fixture }));
  await page.goto("http://riftlogs.test/game");
  const observations: CompactObservation[] = [];
  const recorder = await startCompactBoardCapture(page, (observation) => observations.push(observation));
  await recorder.flush();
  assert.equal(observations[0].state.cards?.[0].name, "Scout");
  await page.locator("button").evaluate((element) => element.setAttribute("data-exhausted", "false"));
  await recorder.flush();
  assert.equal(observations.at(-1)?.state.cards?.[0].exhausted, false);
  assert.deepEqual(observations.at(-1)?.sections, ["cards"]);
  await page.locator("main").evaluate((element) => element.setAttribute("data-turn-number", "2"));
  await recorder.flush();
  assert.equal(observations.at(-1)?.sections.length, 4);
  await page.reload();
  await recorder.flush();
  assert.equal(observations.at(-1)?.state.context.turn, 1);
  assert.equal(new Set(observations.map((entry) => entry.sequence)).size, observations.length);
  await page.close();

  const viewer = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const imageFailures: string[] = [];
  viewer.on("requestfailed", (request) => { if (request.resourceType() === "image") imageFailures.push(request.failure()?.errorText ?? "Unknown error"); });
  viewer.on("pageerror", (error) => errors.push(error.message));
  await viewer.goto("http://127.0.0.1:5173/");
  await viewer.getByRole("button", { name: "Recorded replays", exact: true }).click();
  await viewer.locator('[aria-label="Recorded capture"] option').nth(1).waitFor({ state: "attached" });
  const capture = await viewer.locator('[aria-label="Recorded capture"] option').nth(1).getAttribute("value");
  await viewer.getByLabel("Recorded capture", { exact: true }).selectOption(capture!);
  await viewer.getByLabel("Replay action", { exact: true }).waitFor();
  const optionCount = await viewer.getByLabel("Replay action", { exact: true }).locator("option").count();
  await viewer.getByLabel("Replay action", { exact: true }).selectOption(String(optionCount - 1));
  assert.equal(await viewer.getByRole("button", { name: "Next", exact: true }).isDisabled(), true);
  await viewer.getByRole("button", { name: "Previous", exact: true }).click();
  await viewer.getByRole("button", { name: "Next", exact: true }).click();
  const gameCount = await viewer.getByLabel("Recorded game", { exact: true }).locator("option").count();
  if (gameCount > 1) await viewer.getByLabel("Recorded game", { exact: true }).selectOption("1");
  else await viewer.getByLabel("Replay action", { exact: true }).selectOption("0");
  assert.equal(await viewer.getByLabel("Replay action", { exact: true }).inputValue(), "0");
  const selectedGameSteps = await viewer.getByLabel("Replay action", { exact: true }).locator("option").count();
  await viewer.getByLabel("Replay action", { exact: true }).selectOption(String(Math.floor(selectedGameSteps / 2)));
  if (await viewer.locator("button.replay-card").count()) {
    const selectedStep = await viewer.getByLabel("Replay action", { exact: true }).inputValue();
    await viewer.getByLabel("Enable local edits").check();
    const card = viewer.locator("button.replay-card").first();
    const before = await card.innerText();
    await card.click();
    await viewer.getByRole("button", { name: /^(Tap|Untap) selected card$/ }).click();
    assert.notEqual(await card.innerText(), before);
    await viewer.getByRole("button", { name: "Previous", exact: true }).click();
    await viewer.getByLabel("Replay action", { exact: true }).selectOption(selectedStep);
    assert.equal(await viewer.locator("button.replay-card").first().innerText(), before);
    await viewer.getByLabel("Enable local edits").uncheck();
  }
  mkdirSync("logs/full-log-capture", { recursive: true });
  await viewer.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".replay-board img")].every((img) => img.complete), undefined, { timeout: 10000 }).catch(() => undefined);
  const loadedImages = await viewer.locator(".replay-board img").evaluateAll((images) => images.filter((img) => (img as HTMLImageElement).naturalWidth > 0).length);
  await viewer.screenshot({ path: "logs/full-log-capture/replay-smoke.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ compactObservations: observations.length, capture, gameCount, loadedImages, imageFailures: [...new Set(imageFailures)], browserErrors: errors }, null, 2));
} finally { await browser.close(); }
