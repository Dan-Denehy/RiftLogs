// @vitest-environment jsdom
import { expect, it } from "vitest";
import { captureBoardState } from "./boardObservation.ts";

it("reads both players from observed DOM fields and retains unknown data", () => {
  document.body.innerHTML = `<main data-viewer-player-id="plr_two" data-opponent-player-id="plr_one"
    data-turn-number="2" data-active-player-id="plr_one" data-viewer-score="0" data-opponent-score="3">
    <div data-player-identity-rail="self"><span data-identity-player-name="true">Player Two</span></div>
    <div data-player-identity-rail="opponent"><span data-identity-player-name="true">Player One</span></div>
    <div data-zone-owner="self" data-rune-ready-count="1" data-rune-used-count="2"></div>
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
