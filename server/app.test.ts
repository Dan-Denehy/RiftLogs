import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "./app.ts";
import { createDatabase } from "./database.ts";
import { LiveCaptureRecorder } from "./liveCaptureStore.ts";
import { saveObservation } from "./boardObservationStore.ts";
import type { CompactObservation } from "../src/boardObservation.ts";

let app: FastifyInstance | undefined;
let temporaryDirectories: string[] = [];

// Model requests from the actual local interface; security tests use injection directly.
function request(options: InjectOptions) {
  return app!.inject({ ...options, headers: {
    host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173", ...options.headers,
  } });
}

afterEach(async () => {
  await app?.close();
  app = undefined;
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories = [];
});

describe("GET /api/health", () => {
  it("confirms that the API and database are available", async () => {
    app = buildApp({ databaseFilename: ":memory:" });

    const response = await request({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});

it("lists persisted board recordings, replays separate rooms and leaves raw observations unchanged", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "riftlogs-board-api-"));
  temporaryDirectories.push(directory);
  const databaseFilename = path.join(directory, "test.db");
  const database = createDatabase(databaseFilename);
  const recorder = LiveCaptureRecorder.start(database.db, { roomId: "ABC", sourceUrl: "https://example.test" });
  const first: CompactObservation = { formatVersion: 1, source: "riftatlas-board", sequence: 1, capturedAt: "2026-01-01T00:00:00Z",
    sections: ["context", "scores", "resources", "cards"], cardScope: "visible-only", logs: [],
    metadata: { room: "ABC", phase: "in_game", resetToken: "ABC:1", authoritativeSequence: 1, url: "https://example.test" },
    state: { context: { turn: 1, activePlayerId: "plr_a" }, players: { plr_a: "A" }, scores: { plr_a: 2 }, resources: {}, cards: [] } };
  saveObservation(database.db, recorder.captureId, first);
  const second = structuredClone(first); second.sequence = 2; second.metadata.room = "DEF"; second.state.scores.plr_a = 0;
  saveObservation(database.db, recorder.captureId, second); recorder.complete(); database.close();
  app = buildApp({ databaseFilename });
  expect((await request({ method: "GET", url: "/api/board-replays" })).json()).toEqual([
    expect.objectContaining({ id: recorder.captureId, observationCount: 2, status: "complete" }),
  ]);
  const response = await request({ method: "GET", url: `/api/board-replays/${recorder.captureId}` });
  expect(response.statusCode).toBe(200);
  expect(response.json().games.map((game: { room: string }) => game.room)).toEqual(["ABC", "DEF"]);
  expect((await request({ method: "GET", url: "/api/board-replays/1oops" })).statusCode).toBe(400);
  expect((await request({ method: "GET", url: "/api/board-replays/999999" })).statusCode).toBe(404);
  const check = createDatabase(databaseFilename);
  try {
    expect(check.db.$client.prepare("SELECT raw_json FROM board_observations WHERE capture_id = ? ORDER BY sequence").all(recorder.captureId)).toEqual([
      { raw_json: JSON.stringify(first) }, { raw_json: JSON.stringify(second) },
    ]);
  } finally { check.close(); }
});

describe("Atlas capture storage", () => {
  it("rejects malformed imports before storage and enforces byte limits", async () => {
    app = buildApp({ databaseFilename: ":memory:" });
    for (const turns of [[null], [123], [{ actions: [null] }], [{ actions: [{ text: {} }] }]]) {
      expect((await request({ method: "POST", url: "/api/atlas-captures",
        headers: { "content-type": "application/vnd.riftlogs.atlas+json" },
        payload: JSON.stringify({ format: "riftlogs-atlas-dom-capture", formatVersion: 1, turns }),
      })).statusCode).toBe(400);
    }
    expect((await request({ method: "POST", url: "/api/atlas-captures", headers: { "content-type": "application/vnd.riftlogs.atlas+json" }, payload: " ".repeat(10 * 1024 * 1024 + 1) })).statusCode).toBe(413);
    const saved = await request({ method: "POST", url: "/api/atlas-captures", headers: { "content-type": "application/vnd.riftlogs.atlas+json" }, payload: '{"source":"riftatlas-dom","turns":[]}' });
    expect(saved.statusCode).toBe(201);
    expect(saved.json().captureId).toBe(1);
  });
  it("stores and returns the original JSON text unchanged", async () => {
    app = buildApp({ databaseFilename: ":memory:" });
    const originalJson =
      '{\n  "source": "riftatlas-dom",\n  "turns": [{"sequence": 0, "turnNumber": "1", "html": "<li></li>"}]\n}\n';

    const importResponse = await request({
      method: "POST",
      url: "/api/atlas-captures",
      headers: {
        "content-type": "application/vnd.riftlogs.atlas+json",
        "x-riftlogs-filename": "atlas-match.json",
      },
      payload: originalJson,
    });

    expect(importResponse.statusCode).toBe(201);
    const { captureId } = importResponse.json<{ captureId: number }>();

    const rawResponse = await request({
      method: "GET",
      url: `/api/atlas-captures/${captureId}/raw`,
    });

    expect(rawResponse.statusCode).toBe(200);
    expect(rawResponse.body).toBe(originalJson);
  });
});

describe("live capture history", () => {
  it("lists a recording and returns its raw ordered events", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "riftlogs-api-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "test.db");
    const database = createDatabase(filename);
    const recorder = LiveCaptureRecorder.start(database.db, {
      roomId: "ROOM1",
      sourceUrl: "https://play.riftatlas.com/game",
    });
    const rawEvent = {
      format: "riftlogs-atlas-live-event",
      capturedAt: "2026-08-26T12:00:00.000Z",
    };
    recorder.append([rawEvent]);
    recorder.complete();
    database.close();

    app = buildApp({ databaseFilename: filename });
    const historyResponse = await request({
      method: "GET",
      url: "/api/live-captures",
    });
    const detailResponse = await request({
      method: "GET",
      url: `/api/live-captures/${recorder.captureId}`,
    });

    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json()).toEqual([
      expect.objectContaining({
        id: recorder.captureId,
        roomId: "ROOM1",
        status: "complete",
        eventCount: 1,
      }),
    ]);
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      events: [
        {
          captureSequence: 1,
          rawJson: JSON.stringify(rawEvent),
        },
      ],
      hiddenCardReveals: [],
      match: { captureId: recorder.captureId, openingCaptured: false, endingCaptured: false, participants: [] },
    });

    const correctionResponse = await request({
      method: "PUT",
      url: `/api/live-captures/${recorder.captureId}/hidden-card-reveal`,
      payload: { actionSequence: 84, hiddenCardId: "hidden-1" },
    });
    const correctedDetail = await request({
      method: "GET",
      url: `/api/live-captures/${recorder.captureId}`,
    });

    expect(correctionResponse.statusCode).toBe(200);
    expect(correctedDetail.json()).toMatchObject({
      hiddenCardReveals: [{ actionSequence: 84, hiddenCardId: "hidden-1" }],
      match: { id: detailResponse.json().match.id },
    });
  });
});
