import Fastify from "fastify";
import { asc, desc, eq, sql } from "drizzle-orm";
import { createDatabase } from "./database.ts";
import { normalizeLiveMatch } from "./matchStore.ts";
import { buildRecordedReplay } from "../src/recordedReplay.ts";
import type { CompactObservation } from "../src/boardObservation.ts";
import { protectLocalRequests, developmentPolicy, type LocalRequestPolicy } from "./localRequests.ts";
import { MAX_CAPTURE_BYTES, readAtlasCapture, validBoardObservation } from "../src/captureValidation.ts";
import {
  liveAtlasCaptures,
  liveAtlasEvents,
  hiddenCardReveals,
  rawAtlasCaptures,
  playerIdObservations,
  players,
  matches,
  boardObservations,
} from "./schema.ts";

type BuildAppOptions = {
  databaseFilename?: string;
  logger?: boolean;
  localRequestPolicy?: LocalRequestPolicy;
};

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: MAX_CAPTURE_BYTES,
  });
  const database = createDatabase(options.databaseFilename);
  protectLocalRequests(app, options.localRequestPolicy ?? developmentPolicy);

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

  app.get("/api/board-replays", async () => {
    return database.db.select({ id: liveAtlasCaptures.id, roomId: liveAtlasCaptures.roomId,
      status: liveAtlasCaptures.status, startedAt: liveAtlasCaptures.startedAt,
      observationCount: sql<number>`count(${boardObservations.id})` })
      .from(liveAtlasCaptures).innerJoin(boardObservations, eq(boardObservations.captureId, liveAtlasCaptures.id))
      .groupBy(liveAtlasCaptures.id).orderBy(desc(liveAtlasCaptures.id)).all();
  });
  app.get<{ Params: { captureId: string } }>("/api/board-replays/:captureId", async (request, reply) => {
    const captureId = parseCaptureId(request.params.captureId);
    if (!Number.isSafeInteger(captureId)) return reply.code(400).send({ error: "Invalid capture ID." });
    const capture = database.db.select().from(liveAtlasCaptures).where(eq(liveAtlasCaptures.id, captureId)).get();
    if (!capture) return reply.code(404).send({ error: "Capture not found." });
    const size = database.db.select({ count: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(length(cast(${boardObservations.rawJson} as blob))), 0)` })
      .from(boardObservations).where(eq(boardObservations.captureId, captureId)).get()!;
    if (size.count > 2000 || size.bytes > 64 * 1024 * 1024) return reply.code(413).send({ error: "Replay exceeds the current loading limit (2,000 observations / 64 MiB). Raw data is unchanged." });
    const rows = database.db.select().from(boardObservations).where(eq(boardObservations.captureId, captureId))
      .orderBy(asc(boardObservations.sequence)).all();
    try {
      const observations: CompactObservation[] = rows.map((row) => {
        const item: unknown = JSON.parse(row.rawJson);
        if (!validBoardObservation(item)) throw new Error("Invalid observation");
        return item;
      });
      return { captureId, games: buildRecordedReplay(observations) };
    } catch {
      return reply.code(422).send({ error: "Replay contains invalid observations or exceeds safe replay expansion limits. Raw data is unchanged." });
    }
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
      const captureId = parseCaptureId(request.params.captureId);
      if (!Number.isSafeInteger(captureId) || captureId < 1) {
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
    const captureId = parseCaptureId(request.params.captureId);
    const actionSequence = request.body?.actionSequence;
    const hiddenCardId = request.body?.hiddenCardId;
    if (
      !Number.isSafeInteger(captureId) ||
      captureId < 1 ||
      typeof actionSequence !== "number" ||
      !Number.isSafeInteger(actionSequence) ||
      actionSequence < 1 ||
      typeof hiddenCardId !== "string" ||
      hiddenCardId.length === 0 || hiddenCardId.length > 256 || /[\x00-\x1f]/.test(hiddenCardId)
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

    let capture;
    try {
      capture = readAtlasCapture(request.body);
    } catch {
      return reply.code(400).send({ error: "Invalid Atlas capture. Check its format and limits: 10 MiB, 500 turns, 10,000 actions." });
    }

    const encodedFilename = request.headers["x-riftlogs-filename"];
    const filename = decodeFilename(encodedFilename);
    if (filename.length > 255 || /[\x00-\x1f]/.test(filename)) return reply.code(400).send({ error: "Invalid capture filename." });
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
      const captureId = parseCaptureId(request.params.captureId);
      if (!Number.isSafeInteger(captureId) || captureId < 1) {
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

function parseCaptureId(value: string) {
  return /^[1-9]\d{0,15}$/.test(value) ? Number(value) : Number.NaN;
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
