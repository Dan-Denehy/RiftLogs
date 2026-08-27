import { describe, expect, it } from "vitest";
import type { DisplayAction, DisplayTurn } from "./atlasCapture";
import {
  findHiddenCardRevealCandidates,
  reconstructMatchState,
} from "./matchState";

describe("match state reconstruction", () => {
  it("tracks points per actor and rolls back the previous event on rewind", () => {
    const turns = fixtureTurns([
      action(1, "Lumi", "green", "Conquered Arena and scored 1.", "battle"),
      action(2, "Opponent", "yellow", "Conquered Shrine and scored 2.", "battle"),
      action(3, "Opponent", "yellow", "Rewound to before their last action.", "rewind"),
    ]);

    const snapshots = reconstructMatchState(turns);
    expect(pointsAt(snapshots.get(2), "Lumi")).toBe(1);
    expect(pointsAt(snapshots.get(2), "Opponent")).toBe(2);
    expect(pointsAt(snapshots.get(3), "Opponent")).toBe(0);
  });

  it("rewinds the game action before a non-undoable trash DOM observation", () => {
    const observation = action(
      4,
      "",
      "",
      "Visible trash top: Pyke, Dockside Butcher.",
      "trash-observation",
    );
    observation.actorPlayerName = null;
    observation.actorPlayerId = null;
    observation.actorResolution = "unknown";
    const turns = fixtureTurns([
      action(1, "Lumi", "green", "Played Pyke, Dockside Butcher from hand to base.", "board"),
      action(2, "Lumi", "green", "Moved Pyke, Dockside Butcher to The Candlelit Sanctum.", "board"),
      action(3, "Lumi", "green", "Moved 1 card from The Candlelit Sanctum to trash.", "trash"),
      observation,
      action(5, "Lumi", "green", "Rewound to before their last action.", "rewind"),
    ]);

    const lumi = reconstructMatchState(turns)
      .get(5)
      ?.players.find((player) => player.playerName === "Lumi");

    expect(lumi?.units).toEqual([
      expect.objectContaining({
        name: "Pyke, Dockside Butcher",
        location: "The Candlelit Sanctum",
      }),
    ]);
  });

  it("uses an adjacent named trash top to resolve an ambiguous battlefield removal", () => {
    const observation = action(
      4,
      "",
      "",
      "Visible trash top: Honest Broker.",
      "trash-observation",
    );
    observation.actorPlayerName = null;
    observation.actorPlayerId = null;
    observation.actorResolution = "unknown";
    observation.observedTrashCards = [{
      zoneIndex: 0,
      cardId: "card-broker",
      zoneOwner: "opponent",
      name: "Honest Broker",
      rawHtml: "",
    }];
    const turns = fixtureTurns([
      action(1, "Opponent", "yellow", "Moved Honest Broker to The Candlelit Sanctum.", "board"),
      action(2, "Opponent", "yellow", "Moved Carrion Dredger to The Candlelit Sanctum.", "board"),
      action(3, "Opponent", "yellow", "Moved 1 card from The Candlelit Sanctum to trash.", "trash"),
      observation,
    ]);

    const opponent = reconstructMatchState(turns)
      .get(4)
      ?.players.find((player) => player.playerName === "Opponent");

    expect(opponent?.units.map((unit) => unit.name)).toEqual(["Carrion Dredger"]);
  });

  it("removes a named trash observation from unclassified cards at base", () => {
    const observation = action(
      3,
      "",
      "",
      "Visible trash top: Stellacorn Herder.",
      "trash-observation",
    );
    observation.actorPlayerName = null;
    observation.actorPlayerId = null;
    observation.actorResolution = "unknown";
    observation.observedTrashCards = [{
      zoneIndex: 0,
      cardId: "card-stellacorn",
      zoneOwner: "self",
      name: "Stellacorn Herder",
      rawHtml: "",
    }];
    const turns = fixtureTurns([
      action(1, "Opponent", "yellow", "Played Stellacorn Herder from hand to base.", "board"),
      action(2, "Opponent", "yellow", "Moved 1 card from base to trash.", "trash"),
      observation,
    ]);

    const opponent = reconstructMatchState(turns)
      .get(3)
      ?.players.find((player) => player.playerName === "Opponent");

    expect(opponent?.unclassifiedBaseCards).toEqual([]);
  });

  it("uses visible score checkpoints for points awarded by unlogged holds", () => {
    const loggedScore = action(
      1,
      "Lumi",
      "green",
      "Conquered Arena and scored 1.",
      "battle",
    );
    const opponentSeen = action(2, "Opponent", "yellow", "Passed focus.", "focus");
    const holdCheckpoint = action(3, "", "", "Observed scores", "score-observation");
    holdCheckpoint.actorPlayerName = null;
    holdCheckpoint.actorPlayerId = null;
    holdCheckpoint.actorResolution = "unknown";
    holdCheckpoint.observedScores = [
      { label: "Your score track", perspective: "your", score: 2, rawHtml: "" },
      { label: "Opponent score track", perspective: "opponent", score: 3, rawHtml: "" },
    ];

    const snapshots = reconstructMatchState(
      fixtureTurns([loggedScore, opponentSeen, holdCheckpoint]),
    );
    expect(pointsAt(snapshots.get(3), "Lumi")).toBe(2);
    expect(pointsAt(snapshots.get(3), "Opponent")).toBe(3);
  });

  it("handles explicit score setting and ignores the postgame 8-to-0 UI reset", () => {
    const winner = action(1, "Lumi", "green", "Set score to 8. (+2)", "score");
    const reset = action(2, "", "", "Observed scores", "score-observation");
    reset.actorPlayerName = null;
    reset.actorPlayerId = null;
    reset.actorResolution = "unknown";
    reset.observedScores = [
      {
        label: "Your score track",
        playerName: "Lumi",
        perspective: "your",
        score: 0,
        rawHtml: "",
      },
    ];

    const snapshots = reconstructMatchState(fixtureTurns([winner, reset]));
    expect(pointsAt(snapshots.get(1), "Lumi")).toBe(8);
    expect(pointsAt(snapshots.get(2), "Lumi")).toBe(8);
  });

  it("reports rune totals at turn start and ready versus total runes at turn end", () => {
    const actions = [
      action(1, "Lumi", "green", "Ended their turn.", "turn"),
      action(2, "Opponent", "yellow", "Ended their turn.", "turn"),
      action(3, "Lumi", "green", "Ended their turn.", "turn"),
      action(
        4,
        "Opponent",
        "yellow",
        "Paid 3 Energy, 1 Power — Exhaust 3 · Recycle 1 Order rune.",
        "resource",
      ),
      action(5, "Opponent", "yellow", "Ended their turn.", "turn"),
    ];
    setTurn([actions[0]], 1, "Lumi", "green");
    setTurn([actions[1]], 2, "Opponent", "yellow");
    setTurn([actions[2]], 3, "Lumi", "green");
    setTurn(actions.slice(3), 4, "Opponent", "yellow");

    const snapshots = reconstructMatchState(fixtureTurns(actions));

    expect(snapshots.get(2)?.runeCheckpoint).toEqual({
      phase: "end",
      playerName: "Opponent",
      totalRunes: 3,
      readyRunes: 3,
    });
    expect(snapshots.get(4)?.runeCheckpoint).toEqual({
      phase: "start",
      playerName: "Opponent",
      totalRunes: 5,
      readyRunes: 5,
    });
    expect(snapshots.get(5)?.runeCheckpoint).toEqual({
      phase: "end",
      playerName: "Opponent",
      totalRunes: 4,
      readyRunes: 2,
    });
  });

  it("does not subtract a recycled rune from the ready count twice", () => {
    const actions = [
      action(1, "Lumi", "green", "Ended their turn.", "turn"),
      action(2, "Opponent", "yellow", "Channeled 1 rune.", "resource"),
      action(
        3,
        "Opponent",
        "yellow",
        "Paid 3 Energy, 1 Power — Exhaust 3 · Recycle 1 Order rune.",
        "resource",
      ),
      action(4, "Opponent", "yellow", "Ended their turn.", "turn"),
    ];
    setTurn([actions[0]], 1, "Lumi", "green");
    setTurn(actions.slice(1), 2, "Opponent", "yellow");

    expect(reconstructMatchState(fixtureTurns(actions)).get(4)?.runeCheckpoint).toEqual({
      phase: "end",
      playerName: "Opponent",
      totalRunes: 3,
      readyRunes: 1,
    });
  });

  it("scores each battlefield held when that player's next turn begins", () => {
    const actions = [
      action(1, "Opponent", "yellow", "Conquered Arena and scored 3.", "battle"),
      action(2, "Opponent", "yellow", "Conquered Shrine and scored 3.", "battle"),
      action(3, "Opponent", "yellow", "Moved Scout to Mystic Vortex.", "board"),
      action(4, "Opponent", "yellow", "Moved Ranger to Treasure Hoard.", "board"),
      action(5, "Lumi", "green", "Ended their turn.", "turn"),
      action(6, "Opponent", "yellow", "Looked at top 1 card(s) of their deck.", "deck"),
    ];
    setTurn(actions.slice(0, 4), 10, "Opponent", "yellow");
    setTurn([actions[4]], 11, "Lumi", "green");
    setTurn([actions[5]], 12, "Opponent", "yellow");

    const opponent = reconstructMatchState(fixtureTurns(actions))
      .get(6)
      ?.players.find((player) => player.playerName === "Opponent");

    expect(opponent?.points).toBe(8);
  });

  it("tracks confirmed unit movement without treating unknown base cards as units", () => {
    const turns = fixtureTurns([
      action(1, "Lumi", "green", "Played Ranger from hand to base.", "board"),
      action(2, "Lumi", "green", "Played Relic from hand to base.", "board"),
      action(3, "Lumi", "green", "Moved Ranger to Arena.", "board"),
      action(4, "Lumi", "green", "Moved 1 card from Arena to trash.", "trash"),
    ]);

    const snapshots = reconstructMatchState(turns);
    const afterMove = snapshots.get(3)?.players.find(
      (player) => player.playerName === "Lumi",
    );
    const afterTrash = snapshots.get(4)?.players.find(
      (player) => player.playerName === "Lumi",
    );
    expect(afterMove?.units).toEqual([
      expect.objectContaining({ name: "Ranger", location: "Arena" }),
    ]);
    expect(afterTrash?.unclassifiedBaseCards).toEqual(["Relic"]);
    expect(afterTrash?.units.some((unit) => unit.name.startsWith("1 card"))).toBe(
      false,
    );
  });

  it("tracks units played directly to battlefields and hidden cards", () => {
    const turns = fixtureTurns([
      action(
        1,
        "Opponent",
        "yellow",
        "Played Fallen Feline from hand to Treasure Hoard.",
        "board",
      ),
      action(
        2,
        "Opponent",
        "yellow",
        "Put a hidden card to Treasure Hoard.",
        "board",
      ),
      action(
        3,
        "Opponent",
        "yellow",
        "Moved 1 card from Treasure Hoard to trash.",
        "trash",
      ),
      action(
        4,
        "Opponent",
        "yellow",
        "Moved 1 card from Treasure Hoard to trash.",
        "trash",
      ),
    ]);

    const opponent = reconstructMatchState(turns)
      .get(2)
      ?.players.find((player) => player.playerName === "Opponent");
    const afterTrash = reconstructMatchState(turns)
      .get(4)
      ?.players.find((player) => player.playerName === "Opponent");

    expect(opponent?.units).toEqual([
      expect.objectContaining({ name: "Fallen Feline", location: "Treasure Hoard" }),
    ]);
    expect(opponent?.hiddenCards).toEqual([
      expect.objectContaining({ location: "Treasure Hoard" }),
    ]);
    expect(afterTrash?.units).toEqual([]);
    expect(afterTrash?.hiddenCards).toEqual([]);
  });

  it("asks for confirmation before naming a hidden card from an unmatched chain", () => {
    const turns = fixtureTurns([
      action(1, "Opponent", "yellow", "Put a hidden card to Treasure Hoard.", "board"),
      action(2, "Opponent", "yellow", "Chain resolved: Pyke, Dockside Butcher.", "spell"),
    ]);
    const uncorrected = reconstructMatchState(turns);
    const candidates = findHiddenCardRevealCandidates(turns, uncorrected);

    expect(candidates).toMatchObject([
      {
        actionSequence: 2,
        actorPlayerName: "Opponent",
        cardName: "Pyke, Dockside Butcher",
        hiddenCards: [{ id: "hidden-1", location: "Treasure Hoard" }],
      },
    ]);

    const corrected = reconstructMatchState(turns, {
      hiddenCardReveals: { 2: "hidden-1" },
    });
    expect(
      corrected
        .get(2)
        ?.players.find((player) => player.playerName === "Opponent")
        ?.hiddenCards[0].name,
    ).toBe("Pyke, Dockside Butcher");
  });

  it("moves a same-name unit from base before moving a copy at another battlefield", () => {
    const turns = fixtureTurns([
      action(1, "Lumi", "green", "Played Scout from hand to base.", "board"),
      action(2, "Lumi", "green", "Played Scout from hand to base.", "board"),
      action(3, "Lumi", "green", "Moved Scout to Treasure Hoard.", "board"),
      action(4, "Lumi", "green", "Moved Scout to Mystic Vortex.", "board"),
      action(5, "Lumi", "green", "Moved 1 card from Treasure Hoard to trash.", "trash"),
    ]);

    const lumi = reconstructMatchState(turns)
      .get(5)
      ?.players.find((player) => player.playerName === "Lumi");

    expect(lumi?.units).toEqual([
      expect.objectContaining({ name: "Scout", location: "Mystic Vortex" }),
    ]);
  });

  it("attaches and moves equipment between units", () => {
    const turns = fixtureTurns([
      action(1, "Lumi", "green", "Played Ranger from hand to base.", "board"),
      action(2, "Lumi", "green", "Played Scout from hand to base.", "board"),
      action(3, "Lumi", "green", "Played Blade from hand to base.", "board"),
      action(4, "Lumi", "green", "Equipped Blade to Ranger.", "board"),
      action(5, "Lumi", "green", "Equipped Blade to Scout.", "board"),
    ]);

    const lumi = reconstructMatchState(turns)
      .get(5)
      ?.players.find((player) => player.playerName === "Lumi");

    expect(lumi?.units.find((unit) => unit.name === "Ranger")?.equipment).toEqual(
      [],
    );
    expect(lumi?.units.find((unit) => unit.name === "Scout")?.equipment).toEqual([
      "Blade",
    ]);
    expect(lumi?.unclassifiedBaseCards).not.toContain("Blade");
  });

  it("removes explicit and auto-paid Gold tokens from base", () => {
    const turns = fixtureTurns([
      action(1, "Lumi", "green", "Played Gold token to base.", "board"),
      action(2, "Lumi", "green", "Played Gold token to base.", "board"),
      action(3, "Lumi", "green", "Used a Gold token.", "board"),
      action(4, "Lumi", "green", "Paid 4 Energy, 1 Power — Exhaust 4 · Gold.", "resource"),
    ]);

    const lumi = reconstructMatchState(turns)
      .get(4)
      ?.players.find((player) => player.playerName === "Lumi");

    expect(lumi?.unclassifiedBaseCards).not.toContain("Gold");
  });

  it("returns attached equipment to base when its unit is trashed", () => {
    const turns = fixtureTurns([
      action(1, "Lumi", "green", "Played Ranger from hand to base.", "board"),
      action(2, "Lumi", "green", "Played Blade from hand to base.", "board"),
      action(3, "Lumi", "green", "Equipped Blade to Ranger.", "board"),
      action(4, "Lumi", "green", "Moved Ranger to Arena.", "board"),
      action(5, "Lumi", "green", "Moved 1 card from Arena to trash.", "trash"),
    ]);

    const lumi = reconstructMatchState(turns)
      .get(5)
      ?.players.find((player) => player.playerName === "Lumi");

    expect(lumi?.units).toEqual([]);
    expect(lumi?.unclassifiedBaseCards).toContain("Blade");
  });
});

function fixtureTurns(actions: DisplayAction[]): DisplayTurn[] {
  return [
    {
      sequence: 0,
      turnNumber: 1,
      turnPlayerId: "green",
      turnPlayerName: "Lumi",
      turnColorKey: null,
      playerTone: "green",
      ariaLabel: "Turn 1, Lumi",
      actions,
    },
  ];
}

function action(
  sequence: number,
  actorPlayerName: string,
  actorPlayerId: string,
  text: string,
  actionType: string,
): DisplayAction {
  return {
    sequence,
    turnSequence: sequence - 1,
    turnNumber: 1,
    turnPlayerName: "Lumi",
    turnPlayerId: "green",
    actorPlayerName,
    actorPlayerId,
    actorMarkerColor: null,
    actorColorKey: null,
    actorResolution: "color-marker",
    actionType,
    text,
    rawHtml: "",
    captureSequence: sequence,
    capturedAt: "",
    rawText: text,
    visibleText: text,
    attributes: {},
    cards: [],
    battlefieldMarkers: [],
    observedScores: [],
    observedTrashCards: [],
  };
}

function setTurn(
  actions: DisplayAction[],
  turnNumber: number,
  turnPlayerName: string,
  turnPlayerId: string,
) {
  for (const current of actions) {
    current.turnNumber = turnNumber;
    current.turnPlayerName = turnPlayerName;
    current.turnPlayerId = turnPlayerId;
  }
}

function pointsAt(
  snapshot: ReturnType<typeof reconstructMatchState> extends Map<number, infer Value>
    ? Value | undefined
    : never,
  playerName: string,
) {
  return snapshot?.players.find((player) => player.playerName === playerName)?.points;
}
