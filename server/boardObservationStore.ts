import { and, eq } from "drizzle-orm";
import type { createDatabase } from "./database.ts";
import type { Observation } from "../src/stateContext.ts";
import { boardObservations } from "./schema.ts";

// Internal typed collector input. Any future external import needs runtime validation.
export function saveObservation(database: ReturnType<typeof createDatabase>["db"], captureId: number, observation: Observation) {
  const rawJson = JSON.stringify(observation);
  return database.transaction((transaction) => {
    const existing = transaction.select().from(boardObservations).where(and(
      eq(boardObservations.captureId, captureId), eq(boardObservations.sequence, observation.sequence),
    )).get();
    if (existing) {
      if (existing.rawJson !== rawJson) throw new Error("Cannot overwrite a raw board observation.");
      return existing.id;
    }
    return transaction.insert(boardObservations).values({ captureId, sequence: observation.sequence, rawJson }).returning().get().id;
  });
}
