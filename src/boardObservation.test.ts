// @vitest-environment jsdom
import { expect, it } from "vitest";
import { captureBoardState } from "./boardObservation.ts";
import { compactDelta, buildRecordedReplay } from "./recordedReplay.ts";
import { diffObservations } from "./stateContext.ts";

it("captures ordered chain ownership and distinguishes empty, hidden and uncaptured chains", () => {
  document.body.innerHTML = `<main data-viewer-player-id="plr_a" data-opponent-player-id="plr_b" data-room-code="ABC"></main>
    <div data-chain-targeting="false">
      <li data-chain-timeline-entry-id="second" data-chain-timeline-position="1"><button data-chain-timeline-card="true" data-chain-timeline-owner="opponent" data-chain-timeline-newest="true" aria-label="Newest chain card: Secret" data-face-down="true"><img src="https://example.test/secret.webp"></button></li>
      <li data-chain-timeline-entry-id="first" data-chain-timeline-position="0"><button data-chain-timeline-card="true" data-chain-timeline-owner="self" data-chain-timeline-newest="false" aria-label="Chain card: Rebuke"><img src="https://example.test/rebuke.webp"></button></li>
    </div>`;
  const first = captureBoardState(document, 1, "first");
  expect(first.state.chain?.map((entry) => entry.id)).toEqual(["first", "second"]);
  expect(first.state.chain?.[0]).toMatchObject({ ownerId: "plr_a", name: "Rebuke", newest: false });
  expect(first.state.chain?.[1]).toMatchObject({ ownerId: "plr_b", name: null, hidden: true, imageUrl: null, imageFallbackUrl: null });
  document.querySelector('[data-chain-targeting]')!.innerHTML = "";
  const second = captureBoardState(document, 2, "second");
  expect(second.state.chain).toEqual([]);
  const delta = compactDelta(first, second)!;
  expect(delta.sections).toContain("cards");
  const steps = buildRecordedReplay([first, delta])[0].steps;
  expect(steps[0].state.chain).toHaveLength(2);
  expect(steps.at(-1)!.state.chain).toEqual([]);
  document.querySelector('[data-chain-targeting]')!.remove();
  expect(captureBoardState(document, 3, "third").state.chain).toBeNull();
});

it("captures observed image URLs without exposing face-down artwork or inventing missing images", () => {
  document.body.innerHTML = `<main data-viewer-player-id="plr_a"><span data-room-code="TEST"></span><div data-drop-zone-root="base">
    <button data-board-card-visual="true" data-visual-owner="self" data-card-id="face" data-drop-zone="base" data-face-down="false"><img alt="Scout" data-card-art-source="https://assets.example.test/scout.webp" src="https://assets.example.test/scout-small.webp"></button>
    <button data-board-card-visual="true" data-visual-owner="self" data-card-id="secret" data-drop-zone="base" data-face-down="true"><img alt="Secret card" data-card-art-source="https://assets.example.test/secret.webp"></button>
    <button data-board-card-visual="true" data-visual-owner="self" data-card-id="missing" data-drop-zone="base"><img alt="No artwork"></button>
    </div><div data-battlefield-marker="battlefieldA"><img alt="Arena" src="https://assets.example.test/arena.webp"></div></main>`;
  const first = captureBoardState(document, 1, "first");
  expect(first.state.cards?.find((card) => card.id === "face")).toMatchObject({ imageUrl: "https://assets.example.test/scout.webp", imageFallbackUrl: "https://assets.example.test/scout-small.webp" });
  expect(first.state.cards?.find((card) => card.id === "secret")).toMatchObject({ name: null, imageUrl: null, imageFallbackUrl: null });
  expect(first.state.cards?.find((card) => card.id === "missing")?.imageUrl).toBeNull();
  expect(first.state.battlefieldImages).toEqual({ battlefieldA: "https://assets.example.test/arena.webp" });
  document.querySelector('[data-card-id="secret"]')!.setAttribute("data-face-down", "false");
  const second = captureBoardState(document, 2, "second");
  const steps = buildRecordedReplay([first, compactDelta(first, second)!])[0].steps;
  expect(steps[0].state.cards?.find((card) => card.id === "secret")?.imageUrl).toBeNull();
  expect(steps[1].state.cards?.find((card) => card.id === "secret")?.imageUrl).toContain("secret.webp");
});

it("maps battlefield marker names to zones, ignores log mentions and preserves historical names", () => {
  document.body.innerHTML = `<main data-viewer-player-id="plr_a"><span data-room-code="TEST"></span></main>
    <div data-battlefield-marker="battlefieldA"><img alt="Vilemaw's Lair"></div>
    <div data-battlefield-marker="battlefieldB"><img alt="Abandoned Hall"></div>
    <button data-battlefield-marker="true"><img alt="Unrelated log mention"></button>`;
  const first = captureBoardState(document, 1, "first");
  expect(first.state.battlefieldNames).toEqual({ battlefieldA: "Vilemaw's Lair", battlefieldB: "Abandoned Hall" });
  document.querySelector('[data-battlefield-marker="battlefieldA"] img')!.setAttribute("alt", "The Candlelit Sanctum");
  const second = captureBoardState(document, 2, "second");
  const delta = compactDelta(first, second)!;
  expect(delta.sections).toEqual(["cards"]);
  expect(diffObservations(first, second)).toEqual(["cards"]);
  const steps = buildRecordedReplay([first, delta])[0].steps;
  expect(steps[0].state.battlefieldNames?.battlefieldA).toBe("Vilemaw's Lair");
  expect(steps[1].state.battlefieldNames?.battlefieldA).toBe("The Candlelit Sanctum");
  document.body.insertAdjacentHTML("beforeend", '<div data-battlefield-marker="battlefieldA"><img alt="Conflicting name"></div>');
  document.querySelector('[data-battlefield-marker="battlefieldB"]')!.remove();
  const third = captureBoardState(document, 3, "third");
  expect(third.state.battlefieldNames).toEqual({});
  expect(buildRecordedReplay([first, delta, compactDelta(second, third)!])[0].steps.at(-1)!.state.battlefieldNames).toEqual({});
});

it("captures battlefield Might by explicit player ID, preserving Atlas's qualification text", () => {
  document.body.innerHTML = `<main data-viewer-player-id="plr_other" data-opponent-player-id="plr_f95b33c6"></main>
    <span data-battlefield-might-zone="battlefieldA" data-battlefield-might-player="plr_f95b33c6" data-might-side="self"
      aria-label="4 Might · Lumi" title="Total Might of face-up units. White counters override printed and equipped Might. Buff markers and red counters are ignored.">
      <span data-battlefield-might-value="4"><span>99</span></span></span>
    <span data-battlefield-might-zone="battlefieldA" data-battlefield-might-player="plr_other" data-might-side="opponent"><span data-battlefield-might-value="0"></span></span>
    <span data-battlefield-might-zone="battlefieldB" data-battlefield-might-player="plr_other"><span data-battlefield-might-value="?"></span></span>`;
  const readings = captureBoardState(document, 1, "now").state.battlefieldMight!;
  expect(readings.find((entry) => entry.playerId === "plr_f95b33c6")).toMatchObject({ zone: "battlefieldA", value: 4, rawValue: "4", side: "self", ariaLabel: "4 Might · Lumi" });
  expect(readings[0].title).toContain("Buff markers and red counters are ignored");
  expect(readings.find((entry) => entry.playerId === "plr_other" && entry.zone === "battlefieldA")?.value).toBe(0);
  expect(readings.find((entry) => entry.zone === "battlefieldB")?.value).toBeNull();
});

it("persists Might-only changes, clears removed totals, and leaves past steps and raw data unchanged", () => {
  document.body.innerHTML = `<main data-viewer-player-id="plr_a"><span data-room-code="TEST"></span></main>
    <span data-battlefield-might-zone="battlefieldA" data-battlefield-might-player="plr_a"><span data-battlefield-might-value="4"></span></span>`;
  const first = captureBoardState(document, 1, "first");
  document.querySelector("[data-battlefield-might-value]")!.setAttribute("data-battlefield-might-value", "6");
  const second = captureBoardState(document, 2, "second");
  const delta = compactDelta(first, second)!;
  expect(delta.sections).toEqual(["cards"]);
  expect(diffObservations(first, second)).toEqual(["cards"]);
  expect(compactDelta(second, structuredClone(second))).toBeNull();
  document.querySelector("[data-battlefield-might-zone]")!.remove();
  const third = captureBoardState(document, 3, "third");
  const removed = compactDelta(second, third)!;
  expect(removed.sections).toEqual(["cards"]);
  const raw = JSON.stringify([first, delta, removed]);
  const steps = buildRecordedReplay([first, delta, removed])[0].steps;
  expect(steps.map((step) => step.state.battlefieldMight?.[0]?.value)).toEqual([4, 6, undefined]);
  expect(JSON.stringify([first, delta, removed])).toBe(raw);
  const legacy = structuredClone(first); delete legacy.state.battlefieldMight;
  expect(buildRecordedReplay([legacy])[0].steps[0].state.battlefieldMight).toEqual([]);
});

it("reads both players from observed DOM fields and retains unknown data", () => {
  document.body.innerHTML = `<main data-viewer-player-id="plr_two" data-opponent-player-id="plr_one"
    data-turn-number="2" data-active-player-id="plr_one" data-viewer-score="0" data-opponent-score="3">
    <div data-player-identity-rail="self"><span data-identity-player-name="true">Player Two</span></div>
    <div data-player-identity-rail="opponent"><span data-identity-player-name="true">Player One</span></div>
    <div data-zone-owner="self"><span data-rune-ready-count="1" data-rune-used-count="2"></span></div>
    <div data-zone-owner="opponent" data-rune-ready-count="4" data-rune-used-count="0"></div>
    <div data-pile-owner="self" data-pile-slot="mainDeck" data-pile-count="30"></div>
  </main>`;
  const observation = captureBoardState(document, 1, "2026-01-01T00:00:00Z");
  expect(observation.state.players).toEqual({ plr_two: "Player Two", plr_one: "Player One" });
  expect(observation.state.resources.plr_two).toEqual({ ready: 1, used: 2, hand: null, deck: 30 });
  expect(observation.state.resources.plr_one.deck).toBeNull();
  expect(observation.state.scores).toEqual({ plr_two: 0, plr_one: 3 });
  expect(observation.state.context.activePlayerId).toBe("plr_one");
  expect(observation.state.cards).toBeNull();
});

it("reads real Atlas visual fields for both seats without mistaking animation hiding for face-down", () => {
  // Reduced from WBMZQ's observed attribute structure, not inferred CSS rotation.
  document.body.innerHTML = `<main data-viewer-player-id="plr_lumi" data-opponent-player-id="plr_frog" data-room-phase="in_game"
    data-authoritative-sequence="146" data-authoritative-reset-token="WBMZQ:1:1">
    <span data-room-code="WBMZQ"></span>
    <div data-drop-zone-root="base" data-zone-owner="self">
      <button data-board-card-visual="true" data-card-id="unit-1" data-drop-zone="base" data-visual-owner="self"
        data-exhausted="true" data-face-down="false" data-visual-hidden="true"><img alt="Rek'Sai, Breacher"></button>
    </div>
    <div data-drop-zone-root="battlefieldA" data-zone-owner="opponent">
      <button data-board-card-visual="true" data-card-id="unit-2" data-drop-zone="battlefieldA" data-visual-owner="opponent"
        data-exhausted="false" data-face-down="false"><img alt="Astral Heron"></button>
      <button data-board-card-visual="true" data-card-id="hidden-1" data-drop-zone="battlefieldA" data-visual-owner="opponent"
        data-exhausted="false" data-face-down="true"><img alt="Secret identity"></button>
    </div>
    <div data-zone-owner="opponent"><button data-drop-zone="trash" data-card-id="trash-1"><img alt="Boots of Swiftness"></button></div>
  </main>`;
  const result = captureBoardState(document, 1, "now");
  expect(result.state.cards?.find((card) => card.id === "unit-1")).toMatchObject({ ownerId: "plr_lumi", name: "Rek'Sai, Breacher", hidden: false, exhausted: true });
  expect(result.state.cards?.find((card) => card.id === "unit-2")).toMatchObject({ ownerId: "plr_frog", zone: "battlefieldA", exhausted: false });
  expect(result.state.cards?.find((card) => card.id === "hidden-1")).toMatchObject({ name: null, hidden: true });
  expect(result.state.cards?.find((card) => card.id === "trash-1")).toMatchObject({ ownerId: "plr_frog", zone: "trash" });
  expect(result.metadata).toMatchObject({ room: "WBMZQ", authoritativeSequence: 146, resetToken: "WBMZQ:1:1" });
});

it("keeps repeated log occurrences in chronological order and deduplicates card wrappers by ID", () => {
  document.body.innerHTML = `<main data-viewer-player-id="plr_a"><div data-drop-zone-root="base">
    <button data-board-card-visual="true" data-card-id="same" data-drop-zone="base" data-visual-owner="self"><img alt="Scout"></button>
    <button data-board-card-visual="true" data-card-id="same" data-drop-zone="base" data-visual-owner="self"><img alt="Scout"></button>
    </div><ul><li data-match-log-group="turn" data-turn-number="1"><ul>
    <li><span data-log-action-placeholder="true"></span>Draw</li><li><span data-log-action-placeholder="true"></span>Draw</li>
    <li><span data-log-action-placeholder="true"></span>Start</li></ul></li></ul></main>`;
  const result = captureBoardState(document, 1, "now");
  expect(result.state.cards).toHaveLength(1);
  expect(result.logs.map((log) => log.text)).toEqual(["Start", "Draw", "Draw"]);
});

it("resolves interleaved actors from match-specific marker palettes, including alpha differences", () => {
  document.body.innerHTML = `<main data-viewer-player-id="plr_a" data-opponent-player-id="plr_b">
    <ul><li data-match-log-group="turn" data-turn-number="2" data-turn-player-id="plr_b">
    <div data-match-log-turn-divider="true"><span class="bg-[rgba(255,187,110,0.5)]">Turn 2 · B</span></div>
    <ul><li><span class="absolute left-[0.08rem] bg-[rgba(120,221,183,0.92)]"></span><span data-log-action-placeholder="true"></span>A reacts</li>
    <li><span class="absolute left-[0.08rem] bg-[rgba(1,2,3,0.92)]"></span><span data-log-action-placeholder="true"></span>Unknown reacts</li></ul></li>
    <li data-match-log-group="turn" data-turn-number="1" data-turn-player-id="plr_a">
    <div data-match-log-turn-divider="true"><span class="bg-[rgba(120,221,183,0.5)]">Turn 1 · A</span></div>
    <ul><li><span class="absolute left-[0.08rem] bg-[rgba(255,187,110,0.92)]"></span><span data-log-action-placeholder="true"></span>B reacts</li></ul></li></ul>
  </main>`;
  const rows = captureBoardState(document, 1, "now").logs;
  expect(rows.find((row) => row.text === "A reacts")?.actorId).toBe("plr_a");
  expect(rows.find((row) => row.text === "B reacts")?.actorId).toBe("plr_b");
  expect(rows.find((row) => row.text === "Unknown reacts")?.actorId).toBeNull();
});
