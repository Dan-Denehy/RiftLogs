import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import type { BoardState, ReplayStep } from "../src/stateContext.ts";

// Deterministic image/failure/privacy check; local web app must be running.
// API and artwork responses are fixtures, so no existing recording or external access is needed.
const state: BoardState = {
  context: { turn: 2, activePlayerId: "p1" }, players: { p1: "Alpha", p2: "Beta" }, scores: { p1: 2, p2: 1 }, resources: {},
  battlefieldNames: { battlefieldA: "Arena", battlefieldB: "Sanctum" },
  battlefieldImages: { battlefieldA: "https://assets.riftatlas-workers.com/battlefield.svg" },
  cards: [
    { id: "unit", name: "Scout", ownerId: "p1", zone: "base", hidden: false, exhausted: false, attachedTo: null, cardType: "unit", imageUrl: "https://assets.riftatlas-workers.com/good.svg" },
    { id: "secret", name: "Secret identity", ownerId: "p2", zone: "battlefieldA", hidden: true, exhausted: false, attachedTo: null, imageUrl: "https://assets.riftatlas-workers.com/secret.svg" },
    { id: "fallback", name: "Fallback", ownerId: "p1", zone: "battlefieldA", hidden: false, exhausted: false, attachedTo: null, imageUrl: "https://assets.riftatlas-workers.com/missing.svg", imageFallbackUrl: "https://assets.riftatlas-workers.com/fallback.svg" },
    { id: "absent", name: "Unavailable", ownerId: "p1", zone: "base", hidden: false, exhausted: false, attachedTo: null, imageUrl: "https://assets.riftatlas-workers.com/missing.svg" },
    { id: "blocked", name: "Blocked host", ownerId: "p1", zone: "base", hidden: false, exhausted: false, attachedTo: null, imageUrl: "https://untrusted.example/tracker.svg" },
  ],
};
// A crowded battlefield must grow sideways, not add rows to the entire board.
for (let i = 0; i < 12; i++) state.cards!.push({
  id: `crowded-${i}`, name: `Extra unit ${i}`, ownerId: "p2", zone: "battlefieldB",
  hidden: false, exhausted: false, attachedTo: null, imageUrl: "https://assets.riftatlas-workers.com/good.svg",
});
for (let i = 0; i < 12; i++) state.cards!.push({
  id: `rune-${i}`, name: `Rune ${i}`, ownerId: "p1", zone: "runeArea",
  hidden: false, exhausted: i % 2 === 0, attachedTo: null, imageUrl: "https://assets.riftatlas-workers.com/good.svg",
});
for (const zone of ["legend", "champion", "trash"]) state.cards!.push({
  id: `command-${zone}`, name: `Example ${zone}`, ownerId: "p1", zone,
  hidden: false, exhausted: false, attachedTo: null, imageUrl: "https://assets.riftatlas-workers.com/good.svg",
});
const steps: ReplayStep[] = [1, 2].map((sequence) => ({ action: { kind: "unknown", sequence, text: `Fixture step ${sequence}` },
  state: structuredClone(state), predicted: structuredClone(state), flags: [], observationSequence: sequence, verifiedPaths: [] }));
const emptyStep = structuredClone(steps[1]);
steps[1].state.scores.p1 = 3; // A real state change remains visible with checkpoint filtering.
emptyStep.action.sequence = 3;
emptyStep.state.cards = [];
steps.push(emptyStep);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const requested: string[] = [];
  const untrustedRequests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("untrusted.example")) untrustedRequests.push(request.url()); });
  await page.route("**/api/board-replays*", (route) => route.fulfill({ json: [{ id: 555, roomId: "Image fixture", status: "complete", observationCount: 2 }] }));
  await page.route("**/api/board-replays/555", (route) => route.fulfill({ json: { captureId: 555, games: [{ number: 1, room: "Fixture", steps, warnings: [] }] } }));
  await page.route("https://assets.riftatlas-workers.com/**", (route) => {
    requested.push(route.request().url());
    if (route.request().url().endsWith("missing.svg")) return route.fulfill({ status: 404, body: "Not found" });
    return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140"><rect width="100" height="140" fill="#368574"/><text x="20" y="70" fill="white">TEST</text></svg>' });
  });
  await page.goto("http://127.0.0.1:5173/");
  await page.getByRole("button", { name: "Recorded replays", exact: true }).click();
  await page.getByLabel("Recorded capture", { exact: true }).selectOption("555");
  await page.locator('img[src="https://assets.riftatlas-workers.com/fallback.svg"]').waitFor();
  await page.getByRole("button", { name: "Unavailable, ready", exact: true }).getByText("Artwork unavailable").waitFor();
  await page.getByRole("button", { name: "Blocked host, ready", exact: true }).getByText("Artwork unavailable").waitFor();
  assert.deepEqual(untrustedRequests, []);
  assert.equal(requested.some((url) => url.includes("secret.svg")), false);
  assert.equal(await page.getByText("Secret identity", { exact: true }).count(), 0);
  const crowded = page.getByRole("region", { name: "Beta Sanctum", exact: true }).locator(".replay-card-list");
  const strip = await crowded.evaluate((element) => ({
    scrolls: element.scrollWidth > element.clientWidth,
    rows: new Set(Array.from(element.children).map((card) => card.getBoundingClientRect().top)).size,
  }));
  assert.equal(strip.scrolls, true);
  assert.equal(strip.rows, 1);
  const assertRuneRows = async () => {
    const layout = await page.getByRole("region", { name: "Alpha Runes", exact: true }).locator(".replay-card-list").evaluate((element) => {
      const rows = new Map<number, number>();
      for (const card of element.children) {
        const y = card.getBoundingClientRect().top;
        rows.set(y, (rows.get(y) ?? 0) + 1);
      }
      return { rows: [...rows.values()], horizontalOverflow: element.scrollWidth > element.clientWidth, verticalOverflow: element.scrollHeight > element.clientHeight };
    });
    assert.deepEqual(layout, { rows: [6, 6], horizontalOverflow: false, verticalOverflow: false });
  };
  await assertRuneRows();
  const runeRightGap = await page.getByRole("region", { name: "Alpha Runes", exact: true }).locator(".replay-card-list").evaluate((element) =>
    element.getBoundingClientRect().right - element.children[5].getBoundingClientRect().right);
  assert.ok(runeRightGap <= 5, "Rune grid must not leave unused space after its sixth column");
  const legend = await page.getByRole("button", { name: "Example legend, ready", exact: true }).boundingBox();
  const champion = await page.getByRole("button", { name: "Example champion, ready", exact: true }).boundingBox();
  const trash = await page.getByRole("button", { name: "Example trash, ready", exact: true }).boundingBox();
  assert.ok(legend && champion && trash);
  assert.ok(legend.width >= 95 && champion.width >= 95);
  assert.equal(legend.y, champion.y);
  assert.ok(trash.y >= legend.y + legend.height);
  assert.equal(await page.locator(".battlefield-background").first().evaluate((element) => getComputedStyle(element).opacity), "0.7");
  assert.equal(await page.locator(".battlefield-divider").count(), 0);
  assert.equal(await page.locator(".battlefield-background img").first().evaluate((element) => getComputedStyle(element).objectPosition), "50% 100%");
  const assertMightPositions = async () => {
    for (const side of ["top", "bottom"]) {
      const lane = page.locator(`.battlefield-lane.side-${side}`).first();
      const area = (await lane.boundingBox())!;
      const label = (await lane.locator(".zone-heading").boundingBox())!;
      assert.equal(area.height, 170);
      if (side === "top") assert.ok(label.y < area.y + 10);
      else assert.ok(label.y + label.height > area.y + area.height - 10);
    }
  };
  await assertMightPositions();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  mkdirSync("logs/full-log-capture", { recursive: true });
  await page.screenshot({ path: "logs/full-log-capture/replay-horizontal.png", fullPage: true });
  await page.getByLabel("Enable local edits").check();
  const scout = page.getByRole("button", { name: "Scout, ready", exact: true });
  await scout.dragTo(page.getByRole("region", { name: "Beta Arena", exact: true }));
  assert.equal(await page.getByRole("region", { name: "Alpha Base", exact: true }).getByRole("button", { name: "Scout, ready", exact: true }).count(), 1);
  await scout.dragTo(page.getByRole("region", { name: "Alpha Arena", exact: true }));
  assert.equal(await page.getByRole("region", { name: "Alpha Arena", exact: true }).getByRole("button", { name: "Scout, tapped", exact: true }).count(), 1);
  await page.getByRole("button", { name: "Flip board", exact: true }).click();
  await assertMightPositions();
  assert.match(await page.locator(".replay-player").first().getAttribute("aria-label") ?? "", /Alpha/);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  assert.equal(await page.getByRole("region", { name: "Alpha Base", exact: true }).getByRole("button", { name: "Scout, ready", exact: true }).count(), 1);
  assert.equal(requested.some((url) => url.includes("secret.svg")), false);
  const zoneSizes = () => page.locator(".replay-zone,.battlefield-table,.replay-board").evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  const populatedSizes = await zoneSizes();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  assert.deepEqual(await zoneSizes(), populatedSizes, "Empty and populated desktop zones must have identical dimensions");
  await page.setViewportSize({ width: 390, height: 844 });
  const emptyMobileSizes = await zoneSizes();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  assert.deepEqual(await zoneSizes(), emptyMobileSizes, "Empty and populated mobile zones must have identical dimensions");
  await assertRuneRows();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  mkdirSync("logs/full-log-capture", { recursive: true });
  await page.screenshot({ path: "logs/full-log-capture/replay-mobile.png", fullPage: true });
  console.log("Image success/fallback, hidden privacy, own-player drag, flip, draft reset and mobile width passed.");
} finally { await browser.close(); }
