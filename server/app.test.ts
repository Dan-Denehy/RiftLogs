import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "./app.ts";
import { createDatabase } from "./database.ts";
import { LiveCaptureRecorder } from "./liveCaptureStore.ts";

let app: FastifyInstance | undefined;
let temporaryDirectories: string[] = [];

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

    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});

describe("Atlas capture storage", () => {
  it("stores and returns the original JSON text unchanged", async () => {
    app = buildApp({ databaseFilename: ":memory:" });
    const originalJson =
      '{\n  "source": "riftatlas-dom",\n  "turns": [{"sequence": 0, "turnNumber": "1", "html": "<li></li>"}]\n}\n';

    const importResponse = await app.inject({
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

    const rawResponse = await app.inject({
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
    const historyResponse = await app.inject({
      method: "GET",
      url: "/api/live-captures",
    });
    const detailResponse = await app.inject({
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
    });
  });
});
