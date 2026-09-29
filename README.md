# RiftLogs

## Full DOM research capture

Run `npm.cmd run full-log-capture` and enter the room ID, or run
`npm.cmd run full-log-capture -- ROOMCODE`. Close any other RiftLogs spectator
browser first: this uses the same dedicated login profile and spectator joining flow.

This separate research mode writes `logs/full-log-capture/full-log-capture-<timestamp>.jsonl`.
Each line is a JSON record with a sequence and receipt time. It saves initial DOM HTML,
DOM mutation batches (including removed nodes and old attribute/text values), changed
full-page snapshots every second, and navigation records. Observation resumes after
page reloads. Keep it running across the entire Bo3; if the next game uses a new room,
join that room manually in the same tab. Press Ctrl+C after the series and wait for
the saved-file message (answer Y if Windows asks to terminate the batch job).

This records the main page DOM, including text, attributes and image URLs, not server
state, iframe/shadow DOM contents, canvas pixels, or image binaries. Mutation batches
are browser observations, not guaranteed individual game actions. Files can grow large.
They are research artifacts, excluded from Git and separate from SQLite history;
the normal Atlas JSON importer does not accept this format. Share the complete JSONL
file for analysis, along with the known game results. Use the normal spectator command
when you want a standard history recording.

RiftLogs captures and analyzes Riftbound match logs from RiftAtlas spectator pages. See [PROJECT_SPEC.md](PROJECT_SPEC.md) for the architecture and current scope.

The current diagnostic checkpoint supports this flow:

1. Capture the currently retained portion of a RiftAtlas match with `tools/capture-atlas-match.js`.
2. Download the generated `atlas-match.json`.
3. Import that file through the RiftLogs web page.
4. RiftLogs stores the original JSON text unchanged and displays its captured turns and actions.

Automatic login, lobby joining, Playwright capture, live monitoring, and normalization are deliberately deferred from this checkpoint. Live monitoring is required for the eventual V1 capture path because RiftAtlas purges events beyond its most recent 100.

## Local development

Install dependencies:

```powershell
npm.cmd install
```

`npm` is Node's package manager. On this Windows machine, using `npm.cmd` avoids PowerShell's script-execution restriction.

Start the API and web app together:

```powershell
npm.cmd run dev
```

Open <http://127.0.0.1:5173>. Vite serves the React page on port 5173 and forwards `/api` requests to Fastify on port 3001.

The **Recorded matches** section loads completed spectator recordings directly
from `riftlogs.db`. It opens the newest recording automatically; select another
capture to reinterpret and display its ordered turn-by-turn event log.

Run the automated tests:

```powershell
npm.cmd test
```

Run TypeScript's static checks without creating output files:

```powershell
npm.cmd run check
```

## Spectator probe

First, open an ordinary Chrome window for a one-time manual login:

```powershell
npm.cmd run spectator:login
```

This command starts installed Google Chrome directly. It does not use Playwright,
automation flags, or a saved password. Sign into Google and RiftAtlas normally,
then close every Chrome window belonging to this dedicated profile. Closing it is
important because Chrome and Playwright cannot use the same profile simultaneously.

After that window is fully closed, launch the spectator probe:

```powershell
npm.cmd run spectator
```

The command asks for the new match's RiftAtlas room ID, reopens the same signed-in
session with Playwright, and joins that room as a spectator. You can also supply the
room ID on the command line:

```powershell
npm.cmd run spectator -- YOUR_ROOM_ID
```

The `--` tells npm to pass what follows to the spectator script instead of treating
it as an npm option. Once the match log appears, the probe creates a live capture in
`riftlogs.db`, saves every currently retained action, and then records each new action
as it appears. Each database event keeps its raw DOM JSON before normalization.
Repeated actions are stored separately. Press `Ctrl+C` or close the spectator browser
to mark the capture complete.

RiftLogs keeps the browser session under
`.riftlogs-spectator-profile/`, which is excluded from Git. When a match log is
visible, the terminal prints the latest action and reports subsequent newest actions
until you close the browser or press `Ctrl+C`.

This is a connectivity probe only. It does not yet persist the live event stream.

## Capture a completed RiftAtlas match

1. Open the completed match's RiftAtlas spectator page.
2. Open the browser developer tools and select **Console**.
3. Open `tools/capture-atlas-match.js` in your editor, copy the entire script's contents, paste those contents into the console, and press Enter. Typing the path itself will cause a `tools is not defined` error because the browser treats it as JavaScript code.
4. The browser downloads `atlas-match.json` and also attempts to copy the JSON to the clipboard.
5. In RiftLogs, select **Select atlas-match.json** and choose that file.

The extractor scans the available match-log DOM, saves turns and actions in chronological order, and warns in the console if it could not capture turn 1. It cannot recover events that RiftAtlas has already purged. Long matches require a spectator capture client that is active during play.

The capture script intentionally retains unknown attributes and raw DOM details. The current parser and sanitized test fixture are based on an observed completed-match capture; additional captures will help cover more action variants.

The earlier `atlas-match-dom.json` shape containing raw turn HTML is also accepted. Local files under `logs/` are ignored by Git because captures may contain player information.
