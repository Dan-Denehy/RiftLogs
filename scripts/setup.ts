import { fileURLToPath } from "node:url";
import { ensureDependencies } from "./setupDependencies.ts";

try {
  ensureDependencies(fileURLToPath(new URL("..", import.meta.url)));
} catch (error) {
  console.error("Setup failed:", error instanceof Error ? error.message : error);
  console.error("Nothing was recorded. Do not install C++ build tools; report this error if retrying does not help.");
  process.exitCode = 1;
}
