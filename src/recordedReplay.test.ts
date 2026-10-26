import { expect, it } from "vitest";
import { buildRecordedReplay, compactDelta, newLogEntries, importantReplaySteps } from "./recordedReplay.ts";
import type { CompactObservation } from "./boardObservation.ts";

function observation(sequence: number): CompactObservation {
  return { formatVersion: 1, source: "riftatlas-board", sequence, capturedAt: `time-${sequence}`,
    sections: ["context", "cards", "scores", "resources"], cardScope: "visible-only",
    metadata: { room: "ABC", phase: "in_game", resetToken: "ABC:0:1", authoritativeSequence: sequence, url: "https://example.test" },
    logs: [], state: { context: { turn: 1, activePlayerId: "plr_a" }, players: { plr_a: "A", plr_b: "B" },
      scores: { plr_a: 0, plr_b: 0 }, resources: {}, cards: [{ id: "card-1", ownerId: "plr_a", name: "Scout", zone: "base", hidden: false, exhausted: true, attachedTo: null }] } };
}
const row = (text: string) => ({ key: text, text, turn: 1 });

it("shows the replacement snapshot instead of a blank board for actions recovered with a rewind", () => {
  const first = observation(1); first.logs = [row("Setup")];
  const second = observation(2); second.logs = [...first.logs, row("Undone move")];
  second.state.cards![0].zone = "battlefieldA";
  const third = observation(3); third.metadata.resetToken = "rewind";
  third.logs = [...first.logs, row("Replacement action"), row("Rewound to before their last action.")];
  third.state.cards![0].zone = "base";
  const visible = importantReplaySteps(buildRecordedReplay([first, second, third])[0].steps);
  const replacement = visible.find((step) => step.action.text === "Replacement action")!;
  expect(replacement.state.players).toEqual(third.state.players);
  expect(replacement.state.cards![0].zone).toBe("base");
  expect(replacement.observationSequence).toBeNull();
  expect(replacement.flags[0].status).toBe("unable-to-verify");
  expect(replacement.note).toContain("Rewind batch:");
  expect(visible.some((step) => step.action.text === "Undone move")).toBe(false);
  replacement.state.cards![0].zone = "trash";
  expect(visible.at(-1)!.state.cards![0].zone).toBe("base");
  expect(third.state.cards![0].zone).toBe("base");
});

it("removes undone actions and board snapshots from normal replay across consecutive rewinds", () => {
  const first = observation(1); first.logs = [row("Setup"), row("Draw"), row("Draw")];
  const second = observation(2); second.logs = [...first.logs, row("Played Scout")];
  second.state.cards![0].zone = "battlefieldA";
  const third = observation(3); third.metadata.resetToken = "rewind-1";
  third.logs = [...first.logs, row("Rewound to before their last action.")];
  const fourth = observation(4); fourth.metadata.resetToken = "rewind-2";
  fourth.logs = [row("Setup"), row("Draw"), row("Rewound to before their last action.")];
  const fifth = observation(5); fifth.metadata.resetToken = "rewind-2";
  fifth.logs = [...fourth.logs, row("Played replacement")];
  const observations = [first, second, third, fourth, fifth];
  const raw = JSON.stringify(observations);
  const game = buildRecordedReplay(observations)[0];
  const visible = importantReplaySteps(game.steps);
  expect(visible.filter((step) => step.action.text === "Draw")).toHaveLength(1);
  expect(visible.some((step) => step.action.text === "Played Scout")).toBe(false);
  expect(visible.some((step) => step.state.cards?.some((card) => card.zone === "battlefieldA"))).toBe(false);
  expect(visible.some((step) => step.action.text === "Played replacement")).toBe(true);
  expect(game.steps.find((step) => step.action.text === "Played Scout")?.superseded).toBe(true);
  expect(JSON.stringify(observations)).toBe(raw);
});

it("does not remove history when a rewind target is ambiguous or outside the retained window", () => {
  const first = observation(1); first.logs = [row("Draw"), row("Draw")];
  const second = observation(2); second.metadata.resetToken = "reset";
  second.logs = [row("Draw"), row("Rewound to before their last action.")];
  const game = buildRecordedReplay([first, second])[0];
  expect(game.steps.some((step) => step.superseded)).toBe(false);
  expect(game.warnings.join(" ")).toContain("could not be matched uniquely");
});

it("hides routine checkpoints without removing repeated actions or changing raw steps", () => {
  const first = observation(1);
  const second = observation(2); second.logs = [row("Draw"), row("Draw")];
  second.state.cards![0].imageUrl = "https://example.test/new-art.webp";
  const third = observation(3); third.logs = second.logs; third.state.scores.plr_a = 1;
  const steps = buildRecordedReplay([first, second, third])[0].steps;
  const original = JSON.stringify(steps);
  const visible = importantReplaySteps(steps);
  expect(visible.map((step) => step.action.text)).toEqual(["Initial recorded position", "Draw", "Draw", "Board updated"]);
  expect(visible[1].state.scores.plr_a).toBe(0);
  expect(visible.at(-1)!.state.scores.plr_a).toBe(1);
  expect(JSON.stringify(steps)).toBe(original);
});

it("keeps rewind checkpoints even when the visible position is unchanged", () => {
  const first = observation(1); const second = observation(2);
  second.metadata.resetToken = "reset";
  const visible = importantReplaySteps(buildRecordedReplay([first, second])[0].steps);
  expect(visible.map((step) => step.action.text)).toEqual(["Initial recorded position", "Rewind/reset"]);
  expect(importantReplaySteps([])).toEqual([]);
});

it("deduplicates overlapping occurrences, not repeated identical action text", () => {
  expect(newLogEntries([row("draw")], [row("draw"), row("draw")]).entries).toHaveLength(1);
  expect(newLogEntries([row("first"), row("draw"), row("draw")], [row("draw"), row("draw"), row("last")]).entries).toEqual([row("last")]);
});
it("stores no duplicate snapshot, targeted changes, and full turn checkpoints", () => {
  const first = observation(1); const second = structuredClone(first);
  expect(compactDelta(first, second)).toBeNull();
  second.state.resources.plr_a = { ready: 2, used: 1, hand: null, deck: 30 };
  expect(compactDelta(first, second)?.sections).toEqual(["resources"]);
  second.state.context.turn = 2;
  expect(compactDelta(first, second)?.sections).toHaveLength(4);
  expect(compactDelta(first, second)?.reason).toBe("turn-boundary");
});
it("end-turn text forces a full check even before the root turn number changes", () => {
  const first = observation(1); const second = observation(2);
  second.logs = [row("07:43Ended their turn.")];
  expect(compactDelta(first, second)?.sections).toHaveLength(4);
});
it("does not apply a later board to earlier batched actions, and preserves the input", () => {
  const first = observation(1); const second = observation(2);
  first.logs = [row("Finalized mulligan.")]; second.logs = [...first.logs, row("Moved Scout."), row("Passed focus.")];
  second.state.cards![0].zone = "battlefieldA";
  const original = JSON.stringify([first, second]);
  const game = buildRecordedReplay([first, second])[0];
  const moved = game.steps.find((step) => step.action.text === "Moved Scout.")!;
  expect(moved.state.cards![0].zone).toBe("base");
  expect(moved.flags[0].status).toBe("unable-to-verify");
  expect(game.steps.at(-1)!.state.cards![0].zone).toBe("battlefieldA");
  expect(JSON.stringify([first, second])).toBe(original);
  moved.state.cards![0].name = "Edited";
  expect(game.steps.at(-1)!.state.cards![0].name).toBe("Scout");
});
it("keeps games separate and does not leak cards or scores between rooms", () => {
  const first = observation(1); first.state.scores.plr_a = 8;
  const second = observation(2); second.metadata.room = "DEF"; second.state.cards = [];
  const games = buildRecordedReplay([first, second]);
  expect(games).toHaveLength(2);
  expect(games[1].steps.at(-1)!.state.cards).toEqual([]);
  expect(games[1].steps.at(-1)!.state.scores.plr_a).toBe(0);
});
it("treats reset tokens and sequence rollback as checkpoints, not extra games", () => {
  const first = observation(10); const second = observation(11); second.metadata.authoritativeSequence = 4;
  second.metadata.resetToken = "ABC:4:2"; second.state.cards = [];
  const game = buildRecordedReplay([first, second])[0];
  expect(game.steps.at(-1)!.action.text).toContain("Rewind/reset");
  expect(game.steps[0].state.cards).toHaveLength(1);
  expect(game.steps.at(-1)!.state.cards).toEqual([]);
  expect(game.warnings.join(" ")).toContain("rewind/reset");
  expect(compactDelta(first, second)?.sections).toHaveLength(4);
});
it("starts a new game after same-room sideboarding and never assumes Bo3 from a win", () => {
  const first = observation(1); first.state.scores.plr_a = 8;
  const second = observation(2); second.metadata.phase = "sideboarding";
  const third = observation(3);
  expect(buildRecordedReplay([first])).toHaveLength(1);
  expect(buildRecordedReplay([first, second, third])).toHaveLength(2);
  expect(buildRecordedReplay([first, second, third])[1].steps[0].observationSequence).toBe(2);
});
it("warns about sampled input, missing setup and log gaps", () => {
  const first = observation(1); first.reason = "initial; sampled-source"; first.logs = [row("Played Scout.")];
  const second = observation(2); second.logs = [row("Different window")];
  const game = buildRecordedReplay([first, second])[0];
  expect(game.warnings.join(" ")).toMatch(/Sampled DOM.*Opening setup.*no retained-log overlap/);
});
it("moves display timestamps out of the action text without changing raw evidence", () => {
  const first = observation(1); first.logs = [row("07:43Ended their turn.")];
  const step = buildRecordedReplay([first])[0].steps[0];
  expect(step.action.text).toBe("Ended their turn.");
  expect(step.timestamp).toBe("07:43");
  expect(first.logs[0].text).toBe("07:43Ended their turn.");
});
it("clears a provisional missing-setup warning when setup subsequently appears", () => {
  const first = observation(1); first.metadata.phase = "sideboarding";
  const second = observation(2); second.metadata.phase = "mulligan";
  const third = observation(3);
  const game = buildRecordedReplay([first, second, third])[0];
  expect(game.warnings.join(" ")).not.toContain("Opening setup");
});
it("does not turn an absent visible card into a death, and rejects out-of-order input", () => {
  const first = observation(1); const second = observation(2); second.state.cards = [];
  expect(buildRecordedReplay([first, second])[0].steps.at(-1)!.state.cards).toEqual([]);
  expect(() => buildRecordedReplay([second, first])).toThrow("increasing sequence");
});
