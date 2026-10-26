import { describe, expect, it } from "vitest";
import config from "./vite.config";
import type { UserConfig } from "vite";

const ignored = (config as UserConfig).server?.watch?.ignored as (path: string) => boolean;

describe("development watcher", () => {
  it("ignores browser profile roots and locked files on Windows and POSIX paths", () => {
    for (const profile of [".riftlogs-spectator-profile", ".playwright-profile"]) {
      for (const separator of ["/", "\\"]) {
        const root = ["C:", "Projects", "RiftLogs", profile].join(separator);
        expect(ignored(root)).toBe(true);
        expect(ignored([root, "Default", "Sessions", "Tabs_123"].join(separator))).toBe(true);
      }
    }
  });

  it("continues watching application source and similarly named files", () => {
    expect(ignored("C:/Projects/RiftLogs/src/ReplayViewer.tsx")).toBe(false);
    expect(ignored("C:/Projects/RiftLogs/.riftlogs-spectator-profile-notes.ts")).toBe(false);
  });
});
