import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function setupFingerprint(root: string) {
  return createHash("sha256").update("riftlogs-setup-v1")
    .update(readFileSync(path.join(root, "package.json")))
    .update(readFileSync(path.join(root, "package-lock.json")))
    .update(`${process.platform}:${process.arch}:${process.versions.node}`).digest("hex");
}

export function verifyDependencies(root: string) {
  const require = createRequire(path.join(root, "package.json"));
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  // This installation policy is for the audited lockfile, not arbitrary future packages.
  // Refuse to silently skip newly introduced lifecycle scripts/native build steps.
  for (const [relative, entry] of Object.entries(lock.packages) as [string, { optional?: boolean; os?: string[] }][]) {
    if (!relative) continue;
    const directory = path.resolve(root, relative);
    if (!directory.startsWith(path.resolve(root, "node_modules") + path.sep)) throw new Error("Unexpected dependency path in lockfile.");
    const manifest = path.join(directory, "package.json");
    if (!existsSync(manifest)) {
      if (entry.optional) continue;
      throw new Error(`Missing dependency: ${relative}`);
    }
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    for (const name of ["preinstall", "install", "postinstall"]) {
      if (pkg.scripts?.[name]) throw new Error(`Setup policy needs review: ${relative} has a ${name} script.`);
    }
    if (existsSync(path.join(directory, "binding.gyp")) &&
        !(pkg.name === "better-sqlite3" && pkg.version === "13.0.3" && pkg.gypfile === false)) {
      throw new Error(`Setup policy needs review: native build in ${relative}.`);
    }
  }
  const sqliteDirectory = path.dirname(require.resolve("better-sqlite3/package.json"));
  if (!existsSync(path.join(sqliteDirectory, "prebuilds", `${process.platform}-${process.arch}.node`))) {
    throw new Error("SQLite's bundled binary is missing for this computer. No compiler will be installed automatically.");
  }
  const Database = require("better-sqlite3");
  const database = new Database(":memory:");
  try {
    database.exec("CREATE TABLE setup_check (value TEXT)");
    database.prepare("INSERT INTO setup_check VALUES (?)").run("working");
    if (database.prepare("SELECT value FROM setup_check").get()?.value !== "working") throw new Error("SQLite check failed.");
  } finally { database.close(); }
  for (const binary of ["vite", "tsc"]) {
    if (!existsSync(path.join(root, "node_modules", ".bin", `${binary}.cmd`))) throw new Error(`Missing ${binary} command.`);
  }
}

export function ensureDependencies(root: string) {
  if (process.platform !== "win32" || Number(process.versions.node.split(".")[0]) !== 24) {
    throw new Error("The preview launcher requires Windows and Node.js 24.");
  }
  const marker = path.join(root, "node_modules", ".riftlogs-setup-ok");
  const fingerprint = setupFingerprint(root);
  // Loading a native addon locks its DLL until Node exits on Windows, even after
  // closing the database. Verify in a child so repair can replace that binary.
  const verify = () => {
    const checked = spawnSync(process.execPath, [fileURLToPath(new URL("./checkDependencies.ts", import.meta.url)), root], {
      encoding: "utf8", windowsHide: true,
    });
    if (checked.error) throw checked.error;
    if (checked.status !== 0) throw new Error(checked.stderr.trim() || "Dependency verification failed.");
  };
  if (existsSync(marker) && readFileSync(marker, "utf8") === fingerprint) {
    try { verify(); return; }
    catch (error) { console.log("Dependency check failed; reinstalling:", error instanceof Error ? error.message : error); }
  }
  if (existsSync(marker)) unlinkSync(marker);
  console.log("Installing locked dependencies using bundled binaries (no C++ build tools required)...");
  // Fixed command only. npm still verifies package integrity and creates executable shims.
  // Explicit includes avoid NODE_ENV=production or omit settings excluding the build tools.
  const result = spawnSync("cmd.exe", ["/d", "/s", "/c", "npm.cmd ci --ignore-scripts --include=dev --include=optional --no-audit --no-fund"], {
    cwd: root, stdio: "inherit", windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Dependency installation failed. Check the error above and retry start.cmd.");
  verify();
  writeFileSync(marker, fingerprint);
  console.log("Dependencies verified; SQLite read/write check passed.");
}
