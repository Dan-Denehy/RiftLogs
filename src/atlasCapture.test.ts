// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  analyzeCaptureCompleteness,
  normalizeRgbKey,
  parseAtlasCapture,
  parseLiveAtlasEvents,
  type DisplayAction,
} from "./atlasCapture";

const GREEN = "120,221,183";
const YELLOW = "255,187,110";

describe("RiftAtlas action ownership", () => {
  it("resolves a green action marker to Lumi in this match", () => {
    const action = actionNamed("Lumi acted");

    expect(action).toMatchObject({
      turnPlayerName: "Lumi",
      actorPlayerName: "Lumi",
      actorPlayerId: "player_lumi",
      actorColorKey: GREEN,
      actorResolution: "color-marker",
    });
  });

  it("resolves a yellow action marker to AtherVee in this match", () => {
    const action = actionNamed("AtherVee acted");

    expect(action).toMatchObject({
      turnPlayerName: "AtherVee",
      actorPlayerName: "AtherVee",
      actorPlayerId: "player_athervee",
      actorColorKey: YELLOW,
      actorResolution: "color-marker",
    });
  });

  it("resolves a yellow reaction inside Lumi's turn to AtherVee", () => {
    const action = actionNamed("AtherVee reacted during Lumi turn");

    expect(action).toMatchObject({
      turnNumber: 9,
      turnPlayerName: "Lumi",
      turnPlayerId: "player_lumi",
      actorPlayerName: "AtherVee",
      actorPlayerId: "player_athervee",
      actorResolution: "color-marker",
    });
  });

  it("resolves a green reaction inside AtherVee's turn to Lumi", () => {
    const action = actionNamed("Lumi reacted during AtherVee turn");

    expect(action).toMatchObject({
      turnNumber: 10,
      turnPlayerName: "AtherVee",
      turnPlayerId: "player_athervee",
      actorPlayerName: "Lumi",
      actorPlayerId: "player_lumi",
      actorResolution: "color-marker",
    });
  });

  it("normalizes different alpha values to the same RGB key", () => {
    expect(normalizeRgbKey("rgba(120, 221, 183, 0.92)")).toBe(GREEN);
    expect(normalizeRgbKey("rgba(120,221,183,0.5)")).toBe(GREEN);
    expect(normalizeRgbKey("rgb(120 221 183 / 80%)")).toBe(GREEN);
  });

  it("leaves an unknown marker color unresolved without using the turn player", () => {
    const action = actionNamed("Unknown color action");

    expect(action).toMatchObject({
      turnPlayerName: "Lumi",
      actorPlayerName: null,
      actorPlayerId: null,
      actorMarkerColor: "rgba(70,100,240,0.9)",
      actorColorKey: "70,100,240",
      actorResolution: "unknown",
    });
    expect(action.rawHtml).toContain("Unknown color action");
  });

  it("keeps repeated identical actions as separate captured events", () => {
    const repeated = parsedActions().filter(
      (action) => action.text === "Passed focus",
    );

    expect(repeated).toHaveLength(2);
    expect(new Set(repeated.map(({ captureSequence }) => captureSequence)).size).toBe(
      2,
    );
  });

  it("keeps turns and newest-first DOM actions in chronological display order", () => {
    const { turns } = parseAtlasCapture(capturedFixture());

    expect(turns.map(({ turnNumber }) => turnNumber)).toEqual([9, 10]);
    expect(turns.flatMap(({ actions }) => actions.map(({ sequence }) => sequence))).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
  });
});

describe("live Atlas event interpretation", () => {
  it("groups ordered database events into turns and resolves reactions", () => {
    const turns = parseLiveAtlasEvents([
      liveRow(1, 1, "Lumi", "player_lumi", GREEN, GREEN, "Lumi opened"),
      liveRow(2, 1, "Lumi", "player_lumi", GREEN, YELLOW, "Opponent reacted"),
      liveRow(3, 2, "Opponent", "player_opponent", YELLOW, GREEN, "Lumi reacted"),
    ]);

    expect(turns.map((turn) => turn.turnNumber)).toEqual([1, 2]);
    expect(turns.flatMap((turn) => turn.actions).map((action) => action.text)).toEqual([
      "Lumi opened",
      "Opponent reacted",
      "Lumi reacted",
    ]);
    expect(turns[0].actions[1].actorPlayerName).toBe("Opponent");
    expect(turns[1].actions[0].actorPlayerName).toBe("Lumi");
  });

  it("warns when turn 1 exists but setup-selection events are absent", () => {
    const turns = parseLiveAtlasEvents([
      liveRow(1, 1, "Lumi", "player_lumi", GREEN, GREEN, "Paid 1 Energy."),
    ]);

    expect(analyzeCaptureCompleteness(turns)).toMatchObject({
      initiatingPhaseCaptured: false,
      initiatingActionSequence: null,
    });
  });

  it("recognizes mulligan or battlefield-selection setup text", () => {
    const mulliganTurns = parseLiveAtlasEvents([
      liveSetupRow(1, "Finalized mulligan (1 recycled, 1 redrawn)."),
    ]);
    const battlefieldTurns = parseLiveAtlasEvents([
      liveRow(1, 1, "Lumi", "player_lumi", GREEN, GREEN, "Lumi selected their battlefields."),
    ]);

    expect(analyzeCaptureCompleteness(mulliganTurns).initiatingPhaseCaptured).toBe(
      true,
    );
    expect(mulliganTurns[0]).toMatchObject({
      turnNumber: null,
      turnPlayerName: null,
    });
    expect(mulliganTurns[0].actions[0].text).toBe(
      "Finalized mulligan (1 recycled, 1 redrawn).",
    );
    expect(
      analyzeCaptureCompleteness(battlefieldTurns).initiatingPhaseCaptured,
    ).toBe(true);
  });
});

function actionNamed(text: string) {
  const action = parsedActions().find((candidate) => candidate.text === text);
  expect(action, `Expected action named "${text}"`).toBeDefined();
  return action as DisplayAction;
}

function parsedActions() {
  return parseAtlasCapture(capturedFixture()).turns.flatMap(
    ({ actions }) => actions,
  );
}

function capturedFixture() {
  return JSON.stringify({
    source: "riftatlas-dom",
    capturedAt: "2026-08-26T00:00:00.000Z",
    url: "https://play.riftatlas.com/game",
    turns: [
      turn({
        turnNumber: 10,
        playerId: "player_athervee",
        playerName: "AtherVee",
        headerColor: "255,196,128",
        paletteColor: YELLOW,
        actions: [
          action(GREEN, "Lumi reacted during AtherVee turn", "spell", "0.5"),
          action(YELLOW, "AtherVee acted", "board", "0.92"),
        ],
      }),
      turn({
        turnNumber: 9,
        playerId: "player_lumi",
        playerName: "Lumi",
        headerColor: "139,229,196",
        paletteColor: GREEN,
        actions: [
          action("70,100,240", "Unknown color action", "inspect", "0.9"),
          action(YELLOW, "AtherVee reacted during Lumi turn", "spell", "0.5"),
          action(GREEN, "Lumi acted", "board", "0.92"),
          action(GREEN, "Passed focus", "turn", "0.5"),
          action(GREEN, "Passed focus", "turn", "0.92"),
          action(GREEN, "Started turn", "turn", "0.92"),
        ],
      }),
    ],
  });
}

type TurnFixture = {
  turnNumber: number;
  playerId: string;
  playerName: string;
  headerColor: string;
  paletteColor: string;
  actions: string[];
};

function turn(fixture: TurnFixture) {
  return {
    turnNumber: String(fixture.turnNumber),
    html: `
      <li data-match-log-group="turn" data-turn-number="${fixture.turnNumber}" data-turn-player-id="${fixture.playerId}">
        <section aria-label="Turn ${fixture.turnNumber}, ${fixture.playerName}">
          <div data-match-log-turn-divider="true" class="text-[rgba(${fixture.headerColor},0.9)]">
            <span class="bg-[linear-gradient(90deg,rgba(${fixture.paletteColor},0.08),rgba(${fixture.paletteColor},0.5))]"></span>
            <span>TURN ${fixture.turnNumber} · ${fixture.playerName}</span>
          </div>
          <ul>${fixture.actions.join("")}</ul>
        </section>
      </li>`,
  };
}

function action(
  markerColor: string,
  text: string,
  actionType: string,
  alpha: string,
) {
  return `
    <li class="action-row">
      <span
        class="absolute left-[0.08rem] top-[0.12rem] bottom-[0.12rem] w-[0.1rem] rounded-full bg-[rgba(${markerColor},${alpha})] shadow-[0_0_6px_rgba(${markerColor},0.5)]"
        aria-hidden="true"
      ></span>
      <p>
        <span data-log-action-kind="${actionType}" data-log-action-label="Action"></span>
        <span>09:19</span>
        <span>${text}</span>
      </p>
    </li>`;
}

function liveRow(
  captureSequence: number,
  turnNumber: number,
  turnPlayerName: string,
  turnPlayerId: string,
  turnColor: string,
  actorColor: string,
  text: string,
) {
  return {
    captureSequence,
    rawJson: JSON.stringify({
      format: "riftlogs-atlas-live-event",
      formatVersion: 1,
      capturedAt: "2026-08-26T12:00:00.000Z",
      turn: {
        turnNumber: String(turnNumber),
        turnPlayerName,
        turnPlayerId,
        ariaLabel: `Turn ${turnNumber}, ${turnPlayerName}`,
        divider: {
          outerHTML: `<div class="bg-[rgba(${turnColor},0.5)]">Turn ${turnNumber} · ${turnPlayerName}</div>`,
          computedStyle: {},
        },
      },
      action: {
        outerHTML: `<li><span class="bg-[rgba(${actorColor},0.92)]"></span><span data-log-action-kind="test"></span>${text}</li>`,
        rawText: text,
        visibleText: text,
        text,
        actionType: "test",
        actionLabel: "Test action",
        timestamp: null,
        attributes: {},
        actorMarker: {
          backgroundColor: `rgba(${actorColor}, 0.92)`,
        },
      },
    }),
  };
}

function liveSetupRow(captureSequence: number, text: string) {
  return {
    captureSequence,
    rawJson: JSON.stringify({
      format: "riftlogs-atlas-live-event",
      formatVersion: 1,
      capturedAt: "2026-08-26T12:00:00.000Z",
      group: { kind: "setup", attributes: {} },
      turn: {
        turnNumber: null,
        turnPlayerName: null,
        turnPlayerId: null,
        ariaLabel: null,
        divider: null,
      },
      action: {
        outerHTML: `<li><span class="bg-[rgba(${YELLOW},0.92)]"></span><p><span data-log-action-placeholder="true"></span><span>11:45</span><span>${text}</span></p></li>`,
        rawText: `11:45${text}`,
        visibleText: `11:45 ${text}`,
        text,
        actionType: null,
        actionLabel: null,
        timestamp: "11:45",
        attributes: {},
        actorMarker: {
          backgroundColor: `rgba(${YELLOW}, 0.92)`,
        },
      },
    }),
  };
}
