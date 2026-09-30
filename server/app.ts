import Fastify from "fastify";
import { asc, desc, eq, sql } from "drizzle-orm";
import { createDatabase } from "./database.ts";
import { normalizeLiveMatch } from "./matchStore.ts";
import {
  liveAtlasCaptures,
  liveAtlasEvents,
  hiddenCardReveals,
  rawAtlasCaptures,
  playerIdObservations,
  players,
  matches,
} from "./schema.ts";

type BuildAppOptions = {
  databaseFilename?: string;
  logger?: boolean;
};

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 10 * 1024 * 1024,
  });
  const database = createDatabase(options.databaseFilename);

  app.addContentTypeParser(
    "application/vnd.riftlogs.atlas+json",
    { parseAs: "string" },
    (_request, body, done) => done(null, body),
  );

  app.get("/api/health", async () => {
    const result = database.db.get<{ ok: number }>(sql`select 1 as ok`);
    return { status: result.ok === 1 ? "ok" : "error" };
  });

  app.get("/api/live-captures", async () => {
    return database.db
      .select({
        id: liveAtlasCaptures.id,
        roomId: liveAtlasCaptures.roomId,
        status: liveAtlasCaptures.status,
        eventCount: liveAtlasCaptures.eventCount,
        startedAt: liveAtlasCaptures.startedAt,
        endedAt: liveAtlasCaptures.endedAt,
      })
      .from(liveAtlasCaptures)
      .orderBy(desc(liveAtlasCaptures.startedAt))
      .all();
  });

  // One row per observed turn-header ID; raw events supply capture time and sequence.
  app.get("/api/player-id-observations", async () => {
    return database.db.select({
      playerId: players.id, displayName: players.displayName,
      observedName: playerIdObservations.observedName,
      atlasPlayerId: playerIdObservations.atlasPlayerId,
      matchId: matches.id, captureId: matches.captureId,
      roomId: liveAtlasCaptures.roomId,
      captureSequence: liveAtlasEvents.captureSequence,
      capturedAt: liveAtlasEvents.capturedAt,
    }).from(playerIdObservations)
      .innerJoin(players, eq(players.id, playerIdObservations.playerId))
      .innerJoin(matches, eq(matches.id, playerIdObservations.matchId))
      .innerJoin(liveAtlasCaptures, eq(liveAtlasCaptures.id, matches.captureId))
      .innerJoin(liveAtlasEvents, eq(liveAtlasEvents.id, playerIdObservations.rawEventId))
      .orderBy(asc(matches.id), asc(liveAtlasEvents.captureSequence)).all();
  });

  app.get<{ Params: { captureId: string } }>(
    "/api/live-captures/:captureId",
    async (request, reply) => {
      const captureId = Number.parseInt(request.params.captureId, 10);
      if (!Number.isInteger(captureId) || captureId < 1) {
        return reply.code(400).send({ error: "Invalid capture ID." });
      }

      const capture = await database.db
        .select()
        .from(liveAtlasCaptures)
        .where(eq(liveAtlasCaptures.id, captureId))
        .get();
      if (!capture) {
        return reply.code(404).send({ error: "Live capture not found." });
      }

      const events = await database.db
        .select({
          captureSequence: liveAtlasEvents.captureSequence,
          rawJson: liveAtlasEvents.rawJson,
        })
        .from(liveAtlasEvents)
        .where(eq(liveAtlasEvents.captureId, captureId))
        .orderBy(asc(liveAtlasEvents.captureSequence))
        .all();

      const reveals = await database.db
        .select({
          actionSequence: hiddenCardReveals.actionSequence,
          hiddenCardId: hiddenCardReveals.hiddenCardId,
        })
        .from(hiddenCardReveals)
        .where(eq(hiddenCardReveals.captureId, captureId))
        .all();

      const match = normalizeLiveMatch(database.db, captureId);
      return { capture, events, hiddenCardReveals: reveals, match };
    },
  );

  app.put<{
    Params: { captureId: string };
    Body: { actionSequence?: unknown; hiddenCardId?: unknown };
  }>("/api/live-captures/:captureId/hidden-card-reveal", async (request, reply) => {
    const captureId = Number.parseInt(request.params.captureId, 10);
    const actionSequence = request.body?.actionSequence;
    const hiddenCardId = request.body?.hiddenCardId;
    if (
      !Number.isInteger(captureId) ||
      captureId < 1 ||
      typeof actionSequence !== "number" ||
      !Number.isInteger(actionSequence) ||
      actionSequence < 1 ||
      typeof hiddenCardId !== "string" ||
      hiddenCardId.length === 0
    ) {
      return reply.code(400).send({ error: "Invalid hidden-card correction." });
    }

    database.db
      .insert(hiddenCardReveals)
      .values({ captureId, actionSequence, hiddenCardId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [hiddenCardReveals.captureId, hiddenCardReveals.actionSequence],
        set: { hiddenCardId, updatedAt: new Date() },
      })
      .run();

    return { actionSequence, hiddenCardId };
  });

  app.post("/api/atlas-captures", async (request, reply) => {
    if (typeof request.body !== "string") {
      return reply.code(400).send({ error: "Expected raw Atlas JSON text." });
    }

    let capture: unknown;
    try {
      capture = JSON.parse(request.body);
    } catch {
      return reply.code(400).send({ error: "The selected file is not valid JSON." });
    }

    if (!isAtlasCapture(capture)) {
      return reply.code(400).send({
        error: "This is not a RiftLogs Atlas DOM capture.",
      });
    }

    const encodedFilename = request.headers["x-riftlogs-filename"];
    const filename = decodeFilename(encodedFilename);
    const [saved] = await database.db
      .insert(rawAtlasCaptures)
      .values({
        filename,
        rawJson: request.body,
        importedAt: new Date(),
      })
      .returning({ id: rawAtlasCaptures.id });

    return reply.code(201).send({
      captureId: saved.id,
      turnCount: capture.turns.length,
    });
  });

  app.get<{ Params: { captureId: string } }>(
    "/api/atlas-captures/:captureId/raw",
    async (request, reply) => {
      const captureId = Number.parseInt(request.params.captureId, 10);
      if (!Number.isInteger(captureId) || captureId < 1) {
        return reply.code(400).send({ error: "Invalid capture ID." });
      }

      const saved = await database.db
        .select({ rawJson: rawAtlasCaptures.rawJson })
        .from(rawAtlasCaptures)
        .where(eq(rawAtlasCaptures.id, captureId))
        .get();

      if (!saved) {
        return reply.code(404).send({ error: "Capture not found." });
      }

      return reply.type("application/json").send(saved.rawJson);
    },
  );

  app.addHook("onClose", async () => {
    database.close();
  });

  return app;
}

function isAtlasCapture(value: unknown): value is { turns: unknown[] } {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Record<string, unknown>;
  const isRiftLogsCapture =
    candidate.format === "riftlogs-atlas-dom-capture" &&
    candidate.formatVersion === 1 &&
    Array.isArray(candidate.turns);
  const isOriginalDomCapture =
    candidate.source === "riftatlas-dom" &&
    Array.isArray(candidate.turns) &&
    candidate.turns.every(
      (turn) =>
        typeof turn === "object" &&
        turn !== null &&
        typeof (turn as Record<string, unknown>).html === "string",
    );

  return isRiftLogsCapture || isOriginalDomCapture;
}

function decodeFilename(value: string | string[] | undefined) {
  const encoded = Array.isArray(value) ? value[0] : value;
  if (!encoded) return "atlas-match.json";

  try {
    return decodeURIComponent(encoded);
  } catch {
    return "atlas-match.json";
  }
}
