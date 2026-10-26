// @vitest-environment jsdom
import { expect, it } from "vitest";
import { captureBoardState, type CompactObservation } from "../src/boardObservation.ts";
import { observeCompactBoard } from "./compactBoardCapture.ts";

it("captures initial state, card readiness changes, turn boundaries and final flush", async () => {
  const events: CompactObservation[] = [];
  const host = window as unknown as { readRiftLogsBoard: typeof captureBoardState; saveRiftLogsBoard: (data: CompactObservation) => Promise<void>; flushRiftLogsBoard: () => Promise<void>; stopRiftLogsBoard: () => Promise<void> };
  host.readRiftLogsBoard = captureBoardState;
  host.saveRiftLogsBoard = async (data) => { events.push(data); };
  document.body.innerHTML = '<main data-viewer-player-id="plr_a" data-turn-number="1"><span data-room-code="ABC"></span><div data-drop-zone-root="base"><button data-card-id="a" data-board-card-visual="true" data-visual-owner="self" data-drop-zone="base" data-exhausted="true"><img alt="Scout"></button></div></main>';
  observeCompactBoard();
  try {
  await host.flushRiftLogsBoard();
  document.querySelector("button")!.setAttribute("data-exhausted", "false");
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(events.at(-1)!.state.cards![0].exhausted).toBe(false);
  document.querySelector("main")!.setAttribute("data-turn-number", "2");
  await host.flushRiftLogsBoard();
  expect(events[0].state.context.turn).toBe(1);
  expect(events.at(-1)!.state.context.turn).toBe(2);
  document.body.insertAdjacentHTML("beforeend", '<span data-battlefield-might-zone="battlefieldA" data-battlefield-might-player="plr_a"><span data-battlefield-might-value="4"></span></span>');
  await host.flushRiftLogsBoard();
  expect(events.at(-1)!.state.battlefieldMight![0].value).toBe(4);
  // Attribute-only change: the rendered text need not change to trigger recording.
  document.querySelector("[data-battlefield-might-value]")!.setAttribute("data-battlefield-might-value", "7");
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(events.at(-1)!.state.battlefieldMight![0].value).toBe(7);
  } finally { await host.stopRiftLogsBoard(); }
});
