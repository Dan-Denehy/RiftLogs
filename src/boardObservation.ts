import { allSections, type BoardState, type Observation, type Section } from "./stateContext.ts";

function count(value: string | null | undefined): number | null {
  return value != null && /^\d+$/.test(value) ? Number(value) : null;
}

// Pure extraction: no timers, network access or database writes.
// Card/hand semantics remain unknown until their extraction is validated.
export function captureBoardState(document: Document, sequence: number, capturedAt: string,
  sections: Section[] = [...allSections]): Observation {
  const root = document.querySelector("[data-viewer-player-id]");
  const state: BoardState = { context: { turn: null, activePlayerId: null }, players: {}, scores: {}, resources: {}, cards: null };
  const validId = (value: string | null | undefined) => value?.startsWith("plr_") ? value : null;
  if (sections.includes("context")) state.context = {
    turn: count(root?.getAttribute("data-turn-number")),
    activePlayerId: validId(root?.getAttribute("data-active-player-id")),
  };
  for (const side of ["self", "opponent"] as const) {
    const prefix = side === "self" ? "viewer" : "opponent";
    const id = validId(root?.getAttribute(`data-${prefix}-player-id`));
    if (!id) continue;
    const name = document.querySelector(`[data-player-identity-rail="${side}"] [data-identity-player-name]`)?.textContent?.trim();
    if (name) state.players[id] = name;
    if (sections.includes("scores")) state.scores[id] = count(root?.getAttribute(`data-${prefix}-score`));
    if (sections.includes("resources")) {
      const runes = document.querySelector(`[data-zone-owner="${side}"][data-rune-ready-count]`);
      const deck = document.querySelector(`[data-pile-owner="${side}"][data-pile-slot="mainDeck"]`);
      state.resources[id] = { ready: count(runes?.getAttribute("data-rune-ready-count")), used: count(runes?.getAttribute("data-rune-used-count")), hand: null, deck: count(deck?.getAttribute("data-pile-count")) };
    }
  }
  return { formatVersion: 1, sequence, capturedAt, sections: [...sections], state };
}
