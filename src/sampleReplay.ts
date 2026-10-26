import { allSections, buildReplay, type BoardCard, type BoardState, type Observation, type ReplayAction } from "./stateContext.ts";

const card = (id: string, name: string, ownerId: string, cardType: BoardCard["cardType"] = "unit"): BoardCard => ({ id, name, ownerId, cardType, zone: "base", hidden: false, exhausted: cardType === "unit", attachedTo: null });
const scout = card("unit-1", "Sample Scout", "p1");
const gear = card("gear-1", "Sample Equipment", "p1", "equipment");
const guard = card("unit-2", "Sample Guard", "p2");
const ranger = card("unit-3", "Sample Ranger", "p1");
export const sampleInitialState: BoardState = {
  context: { turn: 1, activePlayerId: "p1" }, players: { p1: "Player One", p2: "Player Two" }, scores: { p1: 0, p2: 0 },
  resources: { p1: { ready: 2, used: 0, hand: 4, deck: 35 }, p2: { ready: 3, used: 0, hand: 4, deck: 35 } }, cards: [],
};
// Expected checkpoints are specified independently of the reducer.
function board(turn: number, cards: BoardCard[], p1: [number | null, number | null, number, number], p2: [number, number, number, number], scores: [number, number]): BoardState {
  const pool = ([ready, used, hand, deck]: typeof p1) => ({ ready, used, hand, deck });
  return { context: { turn, activePlayerId: turn === 2 ? "p2" : "p1" }, players: { ...sampleInitialState.players }, scores: { p1: scores[0], p2: scores[1] }, resources: { p1: pool(p1), p2: pool(p2) }, cards };
}
type Input = ReplayAction extends infer A ? A extends ReplayAction ? Omit<A, "sequence"> : never : never;
export const sampleEntries: Array<{ action: ReplayAction; observation?: Observation }> = [];
function event(action: Input, state?: BoardState) {
  const sequence = sampleEntries.length + 1;
  sampleEntries.push({ action: { ...action, sequence } as ReplayAction, ...(state ? { observation: { formatVersion: 1 as const, sequence, capturedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(), sections: [...allSections], state } } : {}) });
}
event({ kind: "turn-start", turn: 1, playerId: "p1", text: "Turn 1 starts" }, sampleInitialState);
event({ kind: "draw", actorId: "p1", count: 1, text: "Player One draws the turn-start card" });
event({ kind: "runes", actorId: "p1", readyDelta: -1, usedDelta: 1, text: "Player One pays: exhaust 1 rune for Scout" });
event({ kind: "play", actorId: "p1", card: scout, fromHand: true, text: "Player One plays Sample Scout" });
event({ kind: "runes", actorId: "p1", readyDelta: -1, usedDelta: 1, text: "Player One pays: exhaust 1 rune for Equipment" });
event({ kind: "play", actorId: "p1", card: gear, fromHand: true, text: "Player One plays Sample Equipment" });
event({ kind: "attach", actorId: "p1", cardId: gear.id, unitId: scout.id, text: "Attach Equipment to Scout" });
event({ kind: "move", actorId: "p1", cardId: scout.id, zone: "battlefieldA", text: "Player One moves Scout to Battlefield A" });
event({ kind: "score", actorId: "p1", amount: 1, text: "Player One scores 1" });
const first = [{ ...scout, zone: "battlefieldA", exhausted: true }, { ...gear, attachedTo: scout.id }];
event({ kind: "turn-end", text: "Turn 1 ends: board agrees" }, board(1, first, [0, 2, 3, 34], [3, 0, 4, 35], [1, 0]));
event({ kind: "turn-start", turn: 2, playerId: "p2", text: "Turn 2 starts" }, board(2, first, [0, 2, 3, 34], [3, 0, 4, 35], [1, 0]));
event({ kind: "runes", actorId: "p2", readyDelta: 2, usedDelta: 0, text: "Player Two channels 2 runes" });
event({ kind: "draw", actorId: "p2", count: 1, text: "Player Two draws the turn-start card" });
event({ kind: "runes", actorId: "p2", readyDelta: -3, usedDelta: 3, text: "Player Two pays: exhaust 3 runes for Guard" });
event({ kind: "play", actorId: "p2", card: guard, fromHand: true, text: "Player Two plays Sample Guard" });
event({ kind: "move", actorId: "p2", cardId: guard.id, zone: "battlefieldA", text: "Player Two moves Guard to contest Battlefield A" });
event({ kind: "draw", actorId: "p1", count: 1, text: "Player One gains a card from a reaction during Player Two's turn" });
event({ kind: "recycle", actorId: "p2", count: 1, from: "used", text: "Player Two recycles 1 exhausted rune" });
event({ kind: "unknown", text: "Ambiguous trash event: interpreter misses Scout movement" });
event({ kind: "score", actorId: "p2", amount: 1, text: "Player Two scores 1" });
const second = [{ ...scout, zone: "trash", exhausted: true }, gear, { ...guard, zone: "battlefieldA", exhausted: true }];
event({ kind: "turn-end", text: "Turn 2 ends: observation corrects missed movement" }, board(2, second, [0, 2, 4, 33], [2, 2, 4, 34], [1, 1]));
event({ kind: "turn-start", turn: 3, playerId: "p1", text: "Turn 3 starts: missed point; rune reading unavailable" }, board(3, second, [null, null, 4, 33], [2, 2, 4, 34], [2, 1]));
event({ kind: "runes", actorId: "p1", readyDelta: 2, usedDelta: 0, text: "Player One channels 2 runes" });
event({ kind: "draw", actorId: "p1", count: 1, text: "Player One draws the turn-start card" });
event({ kind: "runes", actorId: "p1", readyDelta: -3, usedDelta: 3, text: "Player One pays: exhaust 3 runes for Ranger" });
event({ kind: "recycle", actorId: "p1", count: 1, from: "used", text: "Player One pays: recycle 1 exhausted rune for Ranger" });
event({ kind: "play", actorId: "p1", card: ranger, fromHand: true, text: "Player One plays Sample Ranger" });
event({ kind: "move", actorId: "p1", cardId: ranger.id, zone: "battlefieldB", text: "Player One moves Ranger to Battlefield B" });
event({ kind: "draw", actorId: "p1", count: 2, text: "Player One gains 2 cards from an effect" });
event({ kind: "score", actorId: "p1", amount: 1, text: "Player One scores 1" });
event({ kind: "turn-end", text: "Turn 3 ends: resource reading restored" }, board(3, [...second, { ...ranger, zone: "battlefieldB", exhausted: true }], [1, 2, 6, 30], [2, 2, 4, 34], [3, 1]));
export function createSampleReplay() { return buildReplay(sampleInitialState, sampleEntries); }
