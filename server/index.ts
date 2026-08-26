import { buildApp } from "./app.ts";

const app = buildApp({ logger: true });

try {
  await app.listen({ host: "127.0.0.1", port: 3001 });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
