import { asc, eq } from "drizzle-orm";
import { isInitiatingPhaseText } from "../src/atlasCapture.ts";
import type { createDatabase } from "./database.ts";
import { liveAtlasEvents, matches, matchPlayers, players, playerIdObservations } from "./schema.ts";

type Database = ReturnType<typeof createDatabase>["db"];

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

// This first normalization stage records metadata, not action ownership or results.
export function normalizeLiveMatch(database: Database, captureId: number) {
  return database.transaction((transaction) => {
    const events = transaction.select().from(liveAtlasEvents)
      .where(eq(liveAtlasEvents.captureId, captureId))
      .orderBy(asc(liveAtlasEvents.captureSequence)).all();
    const names = new Map<string, string>();
    const observations: Array<{ rawEventId: number; normalizedName: string; observedName: string; atlasPlayerId: string }> = [];
    let openingCaptured = false;
    for (const row of events) {
      const event = record(JSON.parse(row.rawJson));
      const turn = record(event.turn);
      const action = record(event.action);
      if (typeof turn.turnPlayerName === "string") {
        const displayName = turn.turnPlayerName.trim();
        const normalizedName = displayName.toLowerCase();
        if (normalizedName && !["opponent", "self", "you", "unknown"].includes(normalizedName)) {
          names.set(normalizedName, displayName);
          const atlasPlayerId = typeof turn.turnPlayerId === "string" ? turn.turnPlayerId.trim() : "";
          if (atlasPlayerId.startsWith("plr_") && atlasPlayerId.length > 4) {
            observations.push({ rawEventId: row.id, normalizedName, observedName: displayName, atlasPlayerId });
          }
        }
      }
      const text = [action.actionLabel, action.text]
        .filter((value): value is string => typeof value === "string").join(" ");
      openingCaptured ||= isInitiatingPhaseText(text);
    }

    const match = transaction.insert(matches).values({ captureId, openingCaptured })
      .onConflictDoUpdate({ target: matches.captureId, set: { openingCaptured, normalizationVersion: 1 } })
      .returning().get();
    for (const [normalizedName, displayName] of names) {
      transaction.insert(players).values({ normalizedName, displayName, createdAt: new Date() })
        .onConflictDoNothing({ target: players.normalizedName }).run();
      const player = transaction.select().from(players)
        .where(eq(players.normalizedName, normalizedName)).get()!;
      transaction.insert(matchPlayers).values({ matchId: match.id, playerId: player.id })
        .onConflictDoNothing().run();
      for (const observation of observations.filter((item) => item.normalizedName === normalizedName)) {
        transaction.insert(playerIdObservations).values({
          rawEventId: observation.rawEventId, matchId: match.id, playerId: player.id,
          atlasPlayerId: observation.atlasPlayerId, observedName: observation.observedName,
        }).onConflictDoNothing().run();
      }
    }
    const participants = transaction.select({
      playerId: players.id, displayName: players.displayName,
      result: matchPlayers.result, finalScore: matchPlayers.finalScore,
    }).from(matchPlayers).innerJoin(players, eq(players.id, matchPlayers.playerId))
      .where(eq(matchPlayers.matchId, match.id)).orderBy(asc(players.id)).all();
    return { ...match, participants };
  });
}
