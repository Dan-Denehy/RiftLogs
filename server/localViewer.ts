import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { buildApp } from "./app.ts";
import { ARTWORK_ORIGIN } from "../src/artworkPolicy.ts";

// No generic file server: only index.html and the JS/CSS bundles it references
// are loaded at startup. Request paths are never passed to the filesystem.
export async function buildLocalViewer(options: { distDirectory: string; databaseFilename?: string; port?: number }) {
  const root = await realpath(options.distDirectory);
  const load = async (relative: string) => {
    const resolved = await realpath(path.join(root, relative));
    const within = path.relative(root, resolved);
    if (within.startsWith("..") || path.isAbsolute(within)) throw new Error("Build asset points outside dist.");
    return readFile(resolved);
  };
  const index = await load("index.html");
  const assets = new Map<string, { body: Buffer; type: string }>();
  assets.set("/", { body: index, type: "text/html; charset=utf-8" });
  assets.set("/index.html", assets.get("/")!);
  const references = [...index.toString("utf8").matchAll(/(?:src|href)="(\/assets\/[A-Za-z0-9_-]+\.(?:js|css))"/g)];
  if (!references.some((match) => match[1].endsWith(".js"))) throw new Error("Missing built interface. Run start.cmd to rebuild it.");
  for (const [, url] of references) assets.set(url, { body: await load(url.slice(1)), type: url.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8" });

  const authority = `127.0.0.1:${options.port ?? 5173}`;
  const origin = `http://${authority}`;
  const app = buildApp({ databaseFilename: options.databaseFilename,
    localRequestPolicy: { hosts: [authority], origins: [origin] } });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Security-Policy", `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src ${ARTWORK_ORIGIN}; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
  });
  app.get("/*", async (request, reply) => {
    const url = request.raw.url?.split("?")[0] ?? "";
    const asset = assets.get(url);
    if (!asset) return reply.code(404).send({ error: "Not found." });
    return reply.type(asset.type).send(asset.body);
  });
  return app;
}
