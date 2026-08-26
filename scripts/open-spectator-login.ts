import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));

if (!chromePath) {
  throw new Error(
    "Google Chrome was not found in either standard Windows installation folder.",
  );
}

const profileDirectory = path.resolve(".riftlogs-spectator-profile");
const riftAtlasUrl = "https://play.riftatlas.com/game";

console.log("Opening ordinary Google Chrome for the one-time RiftAtlas login.");
console.log("After signing in, close every window using this dedicated profile.");
console.log("Then run: npm.cmd run spectator");

const chrome = spawn(
  chromePath,
  [`--user-data-dir=${profileDirectory}`, riftAtlasUrl],
  {
    detached: true,
    stdio: "ignore",
  },
);

chrome.unref();
