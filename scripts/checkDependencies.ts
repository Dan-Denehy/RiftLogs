import { verifyDependencies } from "./setupDependencies.ts";

try {
  if (!process.argv[2]) throw new Error("Missing project folder.");
  verifyDependencies(process.argv[2]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
