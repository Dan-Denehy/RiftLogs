import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "./database.ts";
import { cards, liveAtlasEvents, players } from "./schema.ts";

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
