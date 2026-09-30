import { describe, expect, it } from "vitest";
import { allSections, applyContextAction, buildReplay, chooseUpdateSections, diffObservations, getStateAtAction, reconcileCheckpoint } from "./stateContext.ts";
import { createSampleReplay, sampleEntries, sampleInitialState } from "./sampleReplay.ts";

describe("three-turn state-context replay", () => {
  it("plays units exhausted and lets a confirmed ready observation override the default", () => {
    const play = sampleEntries[3].action;
    if (play.kind !== "play") throw new Error("Expected sample play");
    const predicted = applyContextAction(sampleInitialState, { ...play, card: { ...play.card, exhausted: false } });
    expect(predicted.cards?.[0].exhausted).toBe(true);
    const observation = structuredClone(sampleEntries[0].observation!);
    observation.sections = ["cards"];
    observation.state.cards = [{ ...predicted.cards![0], exhausted: false }];
    const reconciled = reconcileCheckpoint(predicted, observation);
    expect(reconciled.state.cards?.[0].exhausted).toBe(false);
    expect(reconciled.flags).toContainEqual({ path: "cards.unit-1.exhausted", expected: true, observed: false, status: "mismatch" });
    expect(createSampleReplay()[5].state.cards?.find((c) => c.id === "gear-1")?.exhausted).toBe(false);
  });
  it("taps board movement but not same-zone or hand/trash transfers", () => {
    const state = createSampleReplay()[3].state;
    state.cards![0].exhausted = false;
    const move = (zone: string) => applyContextAction(state, { sequence: 100, kind: "move", cardId: "unit-1", zone, text: "Move" });
    expect(move("battlefieldA").cards?.[0].exhausted).toBe(true);
    expect(move("base").cards?.[0].exhausted).toBe(false);
    expect(move("hand").cards?.[0].exhausted).toBe(false);
    expect(move("trash").cards?.[0].exhausted).toBe(false);
    expect(state.cards?.[0].exhausted).toBe(false);
    expect(createSampleReplay()[15].state.cards?.find((c) => c.id === "unit-2")?.exhausted).toBe(true);
  });
  it("counts gains and recycling per current turn including opening draws and reactions", () => {
    const replay = createSampleReplay();
    expect(replay[9].state.turnActivity?.p1.cardsGained).toBe(1);
    expect(replay[10].state.turnActivity?.p1.cardsGained).toBe(0);
    expect(replay[20].state.turnActivity).toEqual({ p1: { cardsGained: 1, runesRecycled: 0 }, p2: { cardsGained: 1, runesRecycled: 1 } });
    expect(replay.at(-1)?.state.turnActivity).toEqual({ p1: { cardsGained: 3, runesRecycled: 1 }, p2: { cardsGained: 0, runesRecycled: 0 } });
    expect(replay[25].state.resources.p1).toMatchObject({ ready: 1, used: 2 });
    expect(replay[2].state.cards).toEqual([]);
    expect(replay[2].state.resources.p1.ready).toBe(1);
    expect(replay[3].state.cards?.[0].name).toBe("Sample Scout");
    expect(replay[14].state.cards?.some((c) => c.ownerId === "p2")).toBe(true);
  });
  it("checks every boundary, flags discrepancies and carries observations forward", () => {
    const replay = createSampleReplay();
    expect(replay[9].flags).toEqual([]);
    expect(replay[20].flags).toContainEqual({ path: "cards.unit-1.zone", expected: "battlefieldA", observed: "trash", status: "mismatch" });
    expect(replay[20].state.cards?.find((c) => c.id === "gear-1")?.attachedTo).toBeNull();
    expect(replay[21].flags).toContainEqual({ path: "scores.p1", expected: 1, observed: 2, status: "mismatch" });
    expect(replay[21].flags).toContainEqual({ path: "resources.p1.ready", expected: 2, observed: null, status: "unable-to-verify" });
    expect(replay[21].state.resources.p1.ready).toBe(2);
    expect(replay.at(-1)?.state.scores.p1).toBe(3);
    expect(replay.at(-1)?.flags).toEqual([]);
  });

  it("supports backward lookup without leaking later state or mutating saved states", () => {
    const replay = createSampleReplay();
    expect(getStateAtAction(replay, 21)?.state.cards?.[0].zone).toBe("trash");
    const earlier = getStateAtAction(replay, 9)!;
    expect(earlier.state.cards?.[0].zone).toBe("battlefieldA");
    earlier.state.cards![0].zone = "changed";
    expect(getStateAtAction(replay, 9)?.state.cards?.[0].zone).toBe("battlefieldA");
    expect(sampleInitialState.cards).toEqual([]);
    expect(getStateAtAction(replay, 999)).toBeNull();
  });

  it("separates the actor from the active player", () => {
    const step = createSampleReplay()[16];
    expect(step.state.context.activePlayerId).toBe("p2");
    expect(step.action.actorId).toBe("p1");
    expect(step.state.turnActivity?.p1.cardsGained).toBe(1);
  });

  it("uses targeted reads between full turn-boundary checks", () => {
    for (const { action } of sampleEntries.filter(({ action }) => action.kind.startsWith("turn-"))) {
      expect(chooseUpdateSections(action)).toEqual(allSections);
    }
    expect(chooseUpdateSections(sampleEntries[1].action)).toEqual(["resources"]);
    expect(chooseUpdateSections(sampleEntries[2].action)).toEqual(["resources"]);
    expect(() => buildReplay(sampleInitialState, [{ action: sampleEntries[0].action }])).toThrow(/full board/);
  });

  it("does not let a resource-only observation erase cards or scores", () => {
    const previous = createSampleReplay()[8].state;
    const observation = structuredClone(sampleEntries[0].observation!);
    observation.sections = ["resources"];
    const result = reconcileCheckpoint(previous, observation);
    expect(result.state.cards).toEqual(previous.cards);
    expect(result.state.context).toEqual(previous.context);
  });

  it("suppresses unchanged observations while retaining repeated actions", () => {
    const observation = sampleEntries[0].observation!;
    expect(diffObservations(observation, { ...observation, sequence: 99 })).toEqual([]);
    const changed = structuredClone(observation);
    changed.state.scores.p1 = 1;
    expect(diffObservations(observation, changed)).toEqual(["scores"]);
    const replay = buildReplay(sampleInitialState, [
      { action: { sequence: 1, kind: "draw", actorId: "p1", count: 1, text: "Draw" } },
      { action: { sequence: 2, kind: "draw", actorId: "p1", count: 1, text: "Draw" } },
    ]);
    expect(replay).toHaveLength(2);
    expect(replay[1].state.resources.p1.hand).toBe(6);
  });
});
