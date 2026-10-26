// @vitest-environment jsdom
import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReplayViewer from "./ReplayViewer";
import { createSampleReplay } from "./sampleReplay";
import CardArtwork, { safeArtworkUrl } from "./CardArtwork";

it("shows observed chain cards and owners without exposing hidden names or artwork", () => {
  const replay = createSampleReplay();
  const ownerId = Object.keys(replay[0].state.players)[0];
  replay[0].state.chain = [
    { id: "1", position: 0, ownerId, name: "Rebuke", hidden: false, newest: false, imageUrl: null, imageFallbackUrl: null },
    { id: "2", position: 1, ownerId: null, name: "SECRET", hidden: true, newest: true, imageUrl: "https://example.test/secret.webp", imageFallbackUrl: null },
  ];
  document.body.innerHTML = renderToStaticMarkup(<ReplayViewer replay={replay} />);
  const panel = document.querySelector('[aria-label="Current chain"]')!;
  expect(panel.textContent).toContain("Rebuke");
  expect(panel.textContent).toContain(replay[0].state.players[ownerId]);
  expect(panel.textContent).toContain("Newest");
  expect(panel.innerHTML).not.toContain("SECRET");
  expect(panel.innerHTML).not.toContain("secret.webp");
  replay[0].state.chain = [];
  expect(renderToStaticMarkup(<ReplayViewer replay={replay} />)).toContain("No cards on the observed chain");
  delete replay[0].state.chain;
  expect(renderToStaticMarkup(<ReplayViewer replay={replay} />)).toContain("Not captured for this position");
});

it("renders safe artwork and withholds every image URL for a hidden card", () => {
  document.body.innerHTML = renderToStaticMarkup(<CardArtwork name="Scout" url="https://assets.riftatlas-workers.com/scout.webp" />);
  expect(document.querySelector("img")?.getAttribute("src")).toBe("https://assets.riftatlas-workers.com/scout.webp");
  const hidden = renderToStaticMarkup(<CardArtwork name="Secret" url="https://assets.riftatlas-workers.com/secret.webp" hidden />);
  expect(hidden).not.toContain("secret.webp");
  expect(hidden).not.toContain("Secret");
  expect(hidden).toContain("Hidden card");
  expect(safeArtworkUrl("file:///C:/secret.png")).toBeNull();
  expect(safeArtworkUrl("javascript:alert(1)")).toBeNull();
  expect(safeArtworkUrl("https://user:password@example.test/card.webp")).toBeNull();
  expect(renderToStaticMarkup(<CardArtwork name="No picture" />)).toContain("Artwork unavailable");
});

it("puts two player lanes inside each shared battlefield, between the player bases", () => {
  const replay = createSampleReplay();
  document.body.innerHTML = renderToStaticMarkup(<ReplayViewer replay={replay} />);
  const board = document.querySelector(".replay-board")!;
  expect(board.querySelectorAll(".shared-battlefields .battlefield-table")).toHaveLength(2);
  expect(board.querySelectorAll(".battlefield-table .battlefield-lane")).toHaveLength(4);
  expect([...board.children].filter((node) => node.matches(".replay-player,.shared-battlefields")).map((node) => node.className)).toEqual([
    "replay-player side-top", "shared-battlefields", "replay-player side-bottom",
  ]);
});

it("keeps battlefield names in accessible labels and move controls without extra nameplates", () => {
  const replay = createSampleReplay();
  replay[0].state.battlefieldNames = { battlefieldA: "Vilemaw's Lair", battlefieldB: "Abandoned Hall" };
  document.body.innerHTML = renderToStaticMarkup(<ReplayViewer replay={replay} />);
  expect(document.querySelector('.battlefield-table')?.getAttribute('aria-label')).toBe("Vilemaw's Lair shared battlefield");
  expect(document.querySelector('.battlefield-divider')).toBeNull();
  expect(document.querySelector('select[aria-label="Move selected card"] option[value="battlefieldB"]')?.textContent).toBe("Abandoned Hall");
  delete replay[0].state.battlefieldNames;
  document.body.innerHTML = renderToStaticMarkup(<ReplayViewer replay={replay} />);
  expect(document.querySelector('select[aria-label="Move selected card"] option[value="battlefieldB"]')?.textContent).toBe("Battlefield B");
});
