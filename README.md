# RiftLogs

## Open a shared replay

Completed spectator recordings automatically create a compressed sharing file in
`exports/capture-ID.riftlogs-replay.json.gz`. Original data stays in SQLite for
debugging; this does not shrink the database. Interrupted recordings remain in
history but are not automatically exported as completed replays.

Start the app, select **Recorded replays**, then **Open replay file** and choose
a `.riftlogs-replay.json.gz` file (for example, the capture #11 file in `exports`).
Use **Next**, **Previous**, or the action selector to replay it. No spectator login
is needed. The file opens locally without being uploaded or added to SQLite history;
reopen it after refreshing. Player names remain visible and card images require internet.

Shared imports accept version 1 JSON or gzip, with limits of 10 MiB per file,
64 MiB decompressed, and 2,000 validated observations, plus replay expansion limits.
To export another recording, run `node scripts/export-shared-replay.ts 11`, replacing
`11` with its capture ID. Exports never overwrite the original recording or an existing export.

## Start here (Windows replay preview)

Install **Node.js 24** from <https://nodejs.org> and **Google Chrome** first.
VS Code is optional; it does not install Node.js for you. Download and extract this
repository, open its folder in VS Code, and choose **Terminal > New Terminal**.
Run this one command from the folder containing `start.cmd`:

```powershell
.\start.cmd
```

The launcher installs locked dependencies on first use (internet required), builds
the interface, starts the local viewer, and opens it in Chrome. Do not also run
`npm run dev`. The launcher serves only the built entry page and referenced JS/CSS
bundles, not the project folder. The interface and API share `http://127.0.0.1:5173`;
the launcher does not start a Vite development server or a second server on port 3001.
Use the printed `http://127.0.0.1:5173` address, not a different hostname or port.
Both API launch modes reject foreign Host/Origin headers and cross-site browser
requests. Imports and corrections require the trusted interface origin. These checks
protect against other websites, not malicious programs already running locally.
Capture imports are limited to 10 MiB, 500 turns and 10,000 actions (2,000 per
turn); malformed fields and excessive nesting are rejected before storage.
Recorded-board loading is limited to 2,000 observations / 64 MiB with additional
replay expansion limits. Exceeding a limit leaves the original data untouched.
Artwork loads only from `https://assets.riftatlas-workers.com` on the standard
HTTPS port. Other URLs show a placeholder; no local-file or arbitrary-host images
are permitted. Raw captured URLs remain unchanged as evidence.

1. First time, choose **L**. Sign into your own RiftAtlas spectator account and
   complete security checks manually. Close all windows from that dedicated login
   profile, then press Enter in the terminal. Do not share this profile with anyone.
2. Choose **R** or press Enter. Enter the room code when asked. Wait for
   **Recording live capture #...** and **Compact board recording active**.
3. Keep the spectator browser open. To finish, type **stop** in the terminal and
   press Enter. Wait for **completed and saved**; Chrome closes after the final save.
4. In the viewer choose **Recorded replays > Refresh recordings**, then your capture.
5. Choose **Q** in the launcher when finished reviewing. Repeat R for another match.

Closing the spectator browser early keeps previously saved data but marks the
capture **interrupted**, because the final save cannot be verified. The database
is `riftlogs.db` in this folder; no password is requested by the terminal.

If Chrome is already using the spectator profile, close that dedicated window and
retry. If startup reports a port conflict, stop the old RiftLogs/dev terminal first.
If login expires or Cloudflare blocks the recorder, choose L to sign in manually.
If Cloudflare continues blocking automated recording, do not repeatedly retry:
recording is not supported in that session and needs further investigation.
If the match log cannot be found within 30 seconds, check the room code and open
the match's log panel before retrying. Vite is used only to build the interface in
this launch path; development commands remain separate. Dependency updates, input
validation, the remaining security review and fresh-install acceptance remain release gates.

The advanced commands below remain available for development and research.

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

The probe also saves compact board observations to `board_observations` in
`riftlogs.db`: card IDs/names/locations/readiness, visible hidden-card placeholders,
scores, rune counts, deck counts, and room/turn/reset metadata. Initial states and
turn boundaries save full checkpoints; otherwise only changed sections are saved.
The original action collector continues running alongside it.

## Recorded board replay

Run `npm.cmd run dev`, open <http://127.0.0.1:5173>, and choose **Recorded replays**.
Select a capture, then a game. Previous/Next walks through log entries and observed
board checkpoints. **Refresh recordings** reloads an active capture. Local move/tap
experiments never change the saved recording.

The replay board uses an Atlas-inspired arrangement: opposing player areas above
and below two shared battlefields, with runes, bases, legend/champion and trash zones.
**Flip board** changes perspective without changing ownership. Select a card for a
larger artwork preview. Tapped cards are marked and their artwork is rotated.

New captures retain Atlas's image URLs for visible cards and battlefield markers.
Images load directly over HTTPS; no separate card API or API key is required, and
RiftLogs does not cache image binaries. Hidden cards use a generic card back and never
load their face-up artwork. Failed or missing images fall back to text. Older compact
recordings without URLs still work; re-import an original full DOM capture into a new
recording to obtain its image references. The synthetic sample has no external artwork.

With the web app running, `node scripts/verify-image-replay.ts` tests artwork success/
failure, hidden-card privacy, drag/drop ownership, flipping and mobile layout using
intercepted fixture responses (no existing recordings or external images needed).

A checkpoint shows the visible board at capture time. A log entry without its own
checkpoint shows the previous observed position and an **Unable to verify** flag;
it does not borrow the future board. Trash is top-card-only. Hand counts, card
types, equipment attachments, and per-turn gain/recycle totals remain unknown in
this observational viewer until their real-data interpretation is connected.
The synthetic replay still demonstrates those interpreted features.

Room changes and explicit next-game setup separate games. Reset-token changes or
server-sequence rollback create rewind checkpoints, keeping earlier history for
review. Room changes identify game segments, not proof of a particular Bo3/Bo5
format. Join the next room manually in the same spectator tab; recording also
reinstalls after a page reload. Keep that tab open for the whole series.

Older action-only captures cannot supply board positions they never recorded.
To derive compact observations from a diagnostic full DOM JSONL capture:

```powershell
npm.cmd run import:board -- "logs/full-log-capture/YOUR_CAPTURE.jsonl"
```

This streams the file (rather than loading the whole file into memory), reads its
full snapshots, and creates a **new** SQLite capture. It never modifies the source
file or older captures. Mutation-only intermediate positions are not reconstructed;
the replay labels missing timing information. Re-running creates another capture.
An optional `--sample-index PATH` reads an existing research snapshot index; those
results explicitly warn that they are sampled, not complete.

`npm.cmd run check` checks TypeScript types without running the program;
`npm.cmd test` runs repeatable fixture tests. With the web app running and a compact
recording imported, `node scripts/verify-compact-browser.ts` checks the collector in
a real headless browser, reload persistence, and replay navigation.

## Capture a completed RiftAtlas match

1. Open the completed match's RiftAtlas spectator page.
2. Open the browser developer tools and select **Console**.
3. Open `tools/capture-atlas-match.js` in your editor, copy the entire script's contents, paste those contents into the console, and press Enter. Typing the path itself will cause a `tools is not defined` error because the browser treats it as JavaScript code.
4. The browser downloads `atlas-match.json` and also attempts to copy the JSON to the clipboard.
5. In RiftLogs, select **Select atlas-match.json** and choose that file.

The extractor scans the available match-log DOM, saves turns and actions in chronological order, and warns in the console if it could not capture turn 1. It cannot recover events that RiftAtlas has already purged. Long matches require a spectator capture client that is active during play.

The capture script intentionally retains unknown attributes and raw DOM details. The current parser and sanitized test fixture are based on an observed completed-match capture; additional captures will help cover more action variants.

The earlier `atlas-match-dom.json` shape containing raw turn HTML is also accepted. Local files under `logs/` are ignored by Git because captures may contain player information.
