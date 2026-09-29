import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "./database.ts";
import { cards, liveAtlasCaptures, liveAtlasEvents, matches, matchPlayers, players } from "./schema.ts";

let database: ReturnType<typeof createDatabase>;

beforeEach(() => {
  database = createDatabase(":memory:");
});

afterEach(() => database.close());

describe("player storage", () => {
  it("stores and retrieves a player with a generated ID and Date", () => {
    const player = {
      displayName: "Lumi",
      normalizedName: "lumi",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const saved = database.db.insert(players).values(player).returning().get();
    const retrieved = database.db.select().from(players).get();

    expect(saved.id).toBeGreaterThan(0);
    expect(retrieved).toEqual({ id: saved.id, ...player });
    expect(retrieved?.createdAt).toBeInstanceOf(Date);
  });

  it("rejects duplicate normalized names without replacing the original", () => {
    const player = {
      displayName: "Lumi",
      normalizedName: "lumi",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    database.db.insert(players).values(player).run();

    expect(() =>
      database.db.insert(players).values({ ...player, displayName: "LUMI" }).run(),
    ).toThrow(/UNIQUE constraint failed: players.normalized_name/);
    expect(database.db.select().from(players).all()).toEqual([
      expect.objectContaining(player),
    ]);
  });
});

describe("card storage", () => {
  it("stores and retrieves a card with a generated ID and known category", () => {
    const card = {
      name: "Stellacorn Herder",
      normalizedName: "stellacorn herder",
      category: "unit",
    };
    const saved = database.db.insert(cards).values(card).returning().get();

    expect(saved.id).toBeGreaterThan(0);
    expect(database.db.select().from(cards).get()).toEqual({ id: saved.id, ...card });
  });

  it("defaults an unclassified card to unknown", () => {
    database.db.insert(cards).values({
      name: "Unidentified Card",
      normalizedName: "unidentified card",
    }).run();

    expect(database.db.select().from(cards).get()?.category).toBe("unknown");
  });

  it("rejects duplicate normalized names without changing the original card", () => {
    const card = {
      name: "Stellacorn Herder",
      normalizedName: "stellacorn herder",
      category: "unit",
    };
    database.db.insert(cards).values(card).run();

    expect(() =>
      database.db.insert(cards).values({ ...card, name: "STELLACORN HERDER" }).run(),
    ).toThrow(/UNIQUE constraint failed: cards.normalized_name/);
    expect(database.db.select().from(cards).all()).toEqual([
      expect.objectContaining(card),
    ]);
  });
});

describe("normalized match storage", () => {
  function createMatch() {
    const capture = database.db.insert(liveAtlasCaptures).values({
      roomId: "TEST", sourceUrl: "https://example.test", status: "complete",
      startedAt: new Date(),
    }).returning().get();
    return database.db.insert(matches).values({ captureId: capture.id }).returning().get();
  }

  function createPlayer(name: string) {
    return database.db.insert(players).values({
      displayName: name, normalizedName: name.toLowerCase(), createdAt: new Date(),
    }).returning().get();
  }

  it("keeps completeness and results unknown until established", () => {
    const match = createMatch();
    const player = createPlayer("Lumi");
    const participant = database.db.insert(matchPlayers).values({
      matchId: match.id, playerId: player.id,
    }).returning().get();
    expect(match).toMatchObject({ openingCaptured: false, endingCaptured: false, normalizationVersion: 1 });
    expect(participant).toMatchObject({ result: "unknown", finalScore: null });
  });

  it("stores two participants and lets a player participate in another match", () => {
    const first = createMatch();
    const second = createMatch();
    const lumi = createPlayer("Lumi");
    const opponent = createPlayer("AtherVee");
    const rows = [
      { matchId: first.id, playerId: lumi.id, result: "win" as const, finalScore: 8 },
      { matchId: first.id, playerId: opponent.id, result: "loss" as const, finalScore: 6 },
      { matchId: second.id, playerId: lumi.id, result: "unknown" as const, finalScore: null },
    ];
    database.db.insert(matchPlayers).values(rows).run();
    expect(database.db.select().from(matchPlayers).all()).toEqual(expect.arrayContaining(rows));
    expect(() => database.db.insert(matchPlayers).values(rows[0]).run()).toThrow(/UNIQUE constraint/);
  });

  it("rejects duplicate capture normalization and missing references", () => {
    const match = createMatch();
    const player = createPlayer("Lumi");
    expect(() => database.db.insert(matches).values({ captureId: match.captureId }).run()).toThrow(/UNIQUE constraint/);
    expect(() => database.db.insert(matches).values({ captureId: 999 }).run()).toThrow(/FOREIGN KEY/);
    expect(() => database.db.insert(matchPlayers).values({ matchId: match.id, playerId: 999 }).run()).toThrow(/FOREIGN KEY/);
    expect(() => database.db.insert(matchPlayers).values({ matchId: 999, playerId: player.id }).run()).toThrow(/FOREIGN KEY/);
  });

  it("rejects a negative final score", () => {
    const match = createMatch();
    const player = createPlayer("Lumi");
    expect(() => database.db.insert(matchPlayers).values({
      matchId: match.id, playerId: player.id, finalScore: -1,
    }).run()).toThrow(/CHECK constraint/);
  });
});

it("rejects events referencing a nonexistent capture", () => {
  expect(() =>
    database.db.insert(liveAtlasEvents).values({
      captureId: 999,
      captureSequence: 1,
      capturedAt: new Date(),
      rawJson: "{}",
    }).run(),
  ).toThrow(/FOREIGN KEY constraint failed/);
});
