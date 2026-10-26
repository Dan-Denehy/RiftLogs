import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setupFingerprint, verifyDependencies } from "./setupDependencies.ts";

function fixture(run: (root: string) => void) {
  const root = mkdtempSync(path.join(tmpdir(), "riftlogs-setup-test-"));
  try {
    writeFileSync(path.join(root, "package.json"), "{}");
    writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ packages: {
      "": {}, "node_modules/example": { version: "1.0.0" },
    } }));
    run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe("launcher dependency verification", () => {
  it("invalidates setup when the manifest or lockfile changes", () => fixture((root) => {
    const first = setupFingerprint(root);
    expect(setupFingerprint(root)).toBe(first);
    writeFileSync(path.join(root, "package.json"), '{"version":"2"}');
    const second = setupFingerprint(root);
    expect(second).not.toBe(first);
    writeFileSync(path.join(root, "package-lock.json"), "{}");
    expect(setupFingerprint(root)).not.toBe(second);
  }));
  it("does not trust npm's partial-install lock marker", () => fixture((root) => {
    mkdirSync(path.join(root, "node_modules"));
    writeFileSync(path.join(root, "node_modules", ".package-lock.json"), "{}");
    expect(() => verifyDependencies(root)).toThrow("Missing dependency");
  }));
  it.each(["preinstall", "install", "postinstall"])("rejects a newly introduced %s script", (name) => fixture((root) => {
    const directory = path.join(root, "node_modules", "example");
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({ scripts: { [name]: "must not run" } }));
    expect(() => verifyDependencies(root)).toThrow(`has a ${name} script`);
  }));
  it("rejects an unexpected implicit native build", () => fixture((root) => {
    const directory = path.join(root, "node_modules", "example");
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "package.json"), "{}");
    writeFileSync(path.join(directory, "binding.gyp"), "{}");
    expect(() => verifyDependencies(root)).toThrow("native build");
  }));
});
