import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLocalViewer } from "../server/localViewer.ts";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const chrome = [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
  "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"]
  .find((candidate): candidate is string => !!candidate && existsSync(candidate));
if (!chrome) {
  console.error("Install Google Chrome, then run start.cmd again. RiftLogs uses a separate Chrome profile for your spectator login.");
  process.exit(1);
}
const ask = async (question: string) => {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await terminal.question(question)).trim(); } finally { terminal.close(); }
};
const runRecorder = () => new Promise<number>((resolve) => {
  // Inherit input only while recording, so stop + Enter belongs to the recorder.
  const child = spawn(process.execPath, ["scripts/spectator-probe.ts"], { stdio: "inherit", env: { ...process.env, RIFTLOGS_CHROME_PATH: chrome } });
  child.once("error", (error) => { console.error("Could not launch recorder:", error.message); resolve(1); });
  child.once("exit", (code) => resolve(code ?? 1));
});
let app: Awaited<ReturnType<typeof buildLocalViewer>> | undefined;
try {
  app = await buildLocalViewer({ distDirectory: path.resolve("dist") });
  await app.listen({ host: "127.0.0.1", port: 5173 });
  console.log("\nRiftLogs is ready: http://127.0.0.1:5173\nYour recordings stay in riftlogs.db on this computer.");
  const viewer = spawn(chrome, ["http://127.0.0.1:5173"], { detached: true, stdio: "ignore" });
  viewer.on("error", () => console.log("Open http://127.0.0.1:5173 in your browser.")); viewer.unref();
  let first = true;
  while (true) {
    const choice = (await ask(`${first ? "First time? Choose L to sign into your spectator account.\n" : ""}[Enter/R] Record a match   [L] Login   [Q] Quit: `)).toLowerCase();
    first = false;
    if (choice === "q") break;
    if (choice === "l") {
      console.log("Sign in and complete Cloudflare manually in the Chrome window. Do not run recording yet. Close ALL windows from this dedicated login profile when finished.");
      const login = spawn(chrome, [`--user-data-dir=${path.resolve(".riftlogs-spectator-profile")}`, "https://play.riftatlas.com/"], { detached: true, stdio: "ignore" });
      login.on("error", (error) => console.error("Could not open login:", error.message)); login.unref();
      await ask("After signing in and closing that login window, press Enter here: ");
    } else if (choice === "" || choice === "r") {
      const code = await runRecorder();
      console.log(code === 0 ? "Recording saved. In the viewer choose Recorded replays, Refresh recordings, then your capture." : "Recording did not finish normally. Saved partial data is retained. For login/security checks choose L; otherwise check the room code and retry.");
    } else console.log("Choose R, L, or Q.");
  }
} catch (error) {
  console.error("RiftLogs could not start. Close any other RiftLogs/dev terminal using port 5173, then retry start.cmd. If build files are missing, start.cmd rebuilds them.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await app?.close();
}
