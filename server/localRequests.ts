import type { FastifyInstance } from "fastify";

export type LocalRequestPolicy = { hosts: string[]; origins: string[] };
export const developmentPolicy: LocalRequestPolicy = {
  hosts: ["127.0.0.1:3001", "127.0.0.1:5173"],
  origins: ["http://127.0.0.1:5173"],
};

export function protectLocalRequests(app: FastifyInstance, policy: LocalRequestPolicy) {
  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Cache-Control", "no-store");
    const host = request.headers.host;
    const origin = request.headers.origin;
    const site = request.headers["sec-fetch-site"];
    const readOnly = request.method === "GET" || request.method === "HEAD";
    // Do not trust forwarded headers: neither runtime uses a trusted reverse proxy.
    const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.ip);
    if (!loopback || !host || !policy.hosts.includes(host) ||
        (origin !== undefined && !policy.origins.includes(origin)) ||
        (site !== undefined && site !== "same-origin" && site !== "none") ||
        (!readOnly && (!origin || !policy.origins.includes(origin)))) {
      return reply.code(403).send({ error: "Request rejected. Open RiftLogs at http://127.0.0.1:5173 using the local launcher." });
    }
  });
}
