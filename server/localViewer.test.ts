import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildLocalViewer } from "./localViewer.ts";

let app: Awaited<ReturnType<typeof buildLocalViewer>> | undefined;
let directory: string | undefined;
const headers = { host: "127.0.0.1:5173" };
async function setup() {
  directory = await mkdtemp(path.join(tmpdir(), "riftlogs-viewer-test-"));
  await mkdir(path.join(directory, "assets"));
  await writeFile(path.join(directory, "index.html"), '<div id="root"></div><script type="module" src="/assets/index-abc.js"></script><link href="/assets/index-abc.css" rel="stylesheet">');
  await writeFile(path.join(directory, "assets/index-abc.js"), "console.log('fixture');");
  await writeFile(path.join(directory, "assets/index-abc.css"), "body {color:white}");
  // Even accidentally copied private files INSIDE dist must not be served.
  await writeFile(path.join(directory, "riftlogs.db"), "PRIVATE TEST DATA");
  await writeFile(path.join(directory, "assets/not-referenced.js"), "PRIVATE TEST DATA");
  app = await buildLocalViewer({ distDirectory: directory, databaseFilename: ":memory:" });
}
afterEach(async () => {
  await app?.close(); app = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});
it("serves only the entry page and referenced build bundles, with the same-origin API", async () => {
  await setup();
  for (const url of ["/", "/index.html", "/assets/index-abc.js", "/assets/index-abc.css", "/api/health"]) {
    const response = await app!.inject({ url, headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  }
});
it("blocks databases, profiles, logs, source, development endpoints and traversal", async () => {
  await setup();
  for (const url of ["/riftlogs.db", "/riftlogs.db-wal", "/.env", "/.git/config", "/logs/test.json",
    "/.riftlogs-spectator-profile/Local%20State", "/.playwright-profile/Default/Cookies",
    "/src/main.tsx", "/@fs/C:/Users/example/secret", "/@vite/client", "/__open-in-editor?file=test",
    "/assets/not-referenced.js", "/assets/../riftlogs.db", "/assets/%2e%2e/riftlogs.db", "/assets/%5c..%5criftlogs.db"]) {
    const response = await app!.inject({ url, headers });
    expect(response.statusCode, url).toBe(404);
    expect(response.body).not.toContain("PRIVATE TEST DATA");
  }
});
it("rejects foreign hosts, foreign origins and writes without a same-origin header", async () => {
  await setup();
  for (const extra of [{ host: "evil.example:5173" }, { origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }]) {
    expect((await app!.inject({ url: "/api/health", headers: { ...headers, ...extra } })).statusCode).toBe(403);
  }
  const payload = JSON.stringify({ source: "riftatlas-dom", turns: [] });
  const write = { method: "POST" as const, url: "/api/atlas-captures", payload };
  expect((await app!.inject({ ...write, headers: { ...headers, "content-type": "text/plain" } })).statusCode).toBe(403);
  expect((await app!.inject({ ...write, headers: { ...headers, origin: "http://127.0.0.1:5173", "content-type": "application/vnd.riftlogs.atlas+json" } })).statusCode).toBe(201);
});
