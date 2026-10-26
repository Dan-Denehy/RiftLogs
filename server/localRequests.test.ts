import { afterEach, expect, it } from "vitest";
import { buildApp } from "./app.ts";

let app: ReturnType<typeof buildApp> | undefined;
afterEach(async () => { await app?.close(); });
const payload = JSON.stringify({ source: "riftatlas-dom", turns: [] });
const host = "127.0.0.1:3001";
const origin = "http://127.0.0.1:5173";

it("rejects foreign, null, missing and spoofed origins before any import is stored", async () => {
  app = buildApp({ databaseFilename: ":memory:" });
  for (const headers of [
    { host }, { host, origin: "null" }, { host, origin: "https://evil.example" },
    { host, origin: "http://127.0.0.1:51730" }, { host, origin: "http://127.0.0.1:5173.evil.example" },
    { host: "evil.example", origin }, { host, origin, "sec-fetch-site": "cross-site" },
    { host, origin, "sec-fetch-site": "same-site" },
    { host: "evil.example", "x-forwarded-host": host, origin },
  ]) {
    const result = await app.inject({ method: "POST", url: "/api/atlas-captures", headers: { ...headers, "content-type": "text/plain" }, payload });
    expect(result.statusCode).toBe(403);
    expect(result.headers["access-control-allow-origin"]).toBeUndefined();
  }
  const allowed = await app.inject({ method: "POST", url: "/api/atlas-captures",
    headers: { host, origin, "sec-fetch-site": "same-origin", "content-type": "application/vnd.riftlogs.atlas+json" }, payload });
  expect(allowed.statusCode).toBe(201);
  expect(allowed.json().captureId).toBe(1); // No rejected request inserted a row.
});

it("protects read endpoints and rejects non-loopback callers and cross-origin preflight", async () => {
  app = buildApp({ databaseFilename: ":memory:" });
  for (const url of ["/api/health", "/api/board-replays", "/api/live-captures", "/api/player-id-observations"]) {
    expect((await app.inject({ url, headers: { host, origin: "https://evil.example" } })).statusCode).toBe(403);
    expect((await app.inject({ url, headers: { host }, remoteAddress: "192.0.2.1" })).statusCode).toBe(403);
    expect((await app.inject({ url, headers: { host } })).statusCode).toBe(200);
  }
  const preflight = await app.inject({ method: "OPTIONS", url: "/api/atlas-captures",
    headers: { host, origin: "https://evil.example", "access-control-request-method": "POST" } });
  expect(preflight.statusCode).toBe(403);
  expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
});

it("allows the Vite proxy's preserved host but rejects unapproved local ports", async () => {
  app = buildApp({ databaseFilename: ":memory:" });
  expect((await app.inject({ url: "/api/health", headers: { host: "127.0.0.1:5173", origin } })).statusCode).toBe(200);
  expect((await app.inject({ url: "/api/health", headers: { host: "127.0.0.1:8888" } })).statusCode).toBe(403);
  expect((await app.inject({ method: "PUT", url: "/api/live-captures/1/hidden-card-reveal",
    headers: { host, origin: "https://evil.example" }, payload: { actionSequence: 1, hiddenCardId: "x" } })).statusCode).toBe(403);
});
