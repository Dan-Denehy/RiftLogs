# RiftLogs: friends' setup guide (Windows)

## TL;DR — quick start

1. Download RiftLogs. The launcher checks for **Node.js 24** and **Google Chrome** and offers to install missing prerequisites with your permission.
2. Download and extract RiftLogs, or clone the repository. Open the folder containing **`start.cmd`** in VS Code, then choose **Terminal → New Terminal**.
3. Run:

   ```powershell
   .\start.cmd
   ```

4. **Watch a replay:** in the browser, choose **Recorded replays → Open replay file** and select the `.riftlogs-replay.json.gz` file. Do not unzip it. No Atlas login is needed; leave the terminal menu open.
5. **Record a match:** in the terminal, choose **L** to log into your spectator account, close that dedicated login window, then press Enter. Choose **R**, enter the room code, and wait for recording to start.
6. **Finish recording:** type **stop**, press Enter, and wait for the save/export messages. Share the compressed file from **`exports`**, not your whole project folder.
7. Choose **Q** at the terminal menu to quit RiftLogs.

If `start.cmd` cannot be found, you are in the wrong folder or have an outdated copy. Detailed instructions and troubleshooting follow below.

RiftLogs lets you watch shared Riftbound replays or record matches through a
RiftAtlas spectator account. This is a preview: it replays what the spectator
could see, not a perfect simulation of every game rule.

## 1. Prerequisites (automatic setup available)

You can skip manual installation and run `start.cmd` first, including by
double-clicking it in File Explorer. It offers to install missing prerequisites
through Windows Package Manager (`winget`). Answer **Y** only if you agree;
Windows may ask for administrator approval and the installer may ask you to
accept agreements. Choosing No stops setup. Installing Node may replace an
existing system-wide version used by other projects.

If WinGet is unavailable or installation fails, install the following manually,
then rerun `start.cmd`. Do not disable antivirus or installer integrity checks.

- **Node.js version 24** from [nodejs.org](https://nodejs.org/). Choose version 24
  specifically; the launcher does not accept other major versions. Node runs
  RiftLogs on your computer. Keep the installer's normal settings.
- **Google Chrome**, if you do not already have it.
- **Visual Studio Code**, if you want to follow the terminal instructions below.
  VS Code is just where you open the folder and type the launch command; it does
  not install Node for you.

Close and reopen VS Code after installing Node.

You need internet for first-time setup and card artwork. You do **not** need an
API key. Watching someone else's replay does **not** require an Atlas login.

## 2. Download RiftLogs

1. Open the repository link provided by the person sharing RiftLogs.
2. Select the branch or release they specified. Do not assume `main` contains the
   preview. For a branch download on GitHub, select that branch, then choose
   **Code → Download ZIP**.
3. Right-click the downloaded ZIP and choose **Extract All**. Do not run the app
   from inside the ZIP.
4. Put the extracted folder somewhere you can keep it, such as
   `Documents\RiftLogs`. Your recordings will be saved there.
5. In VS Code, choose **File → Open Folder** and open the folder containing
   `start.cmd` and `package.json`. Sometimes this is one folder inside the
   extracted folder.

Only run a copy from someone you trust. You should not need administrator mode
or need to turn off antivirus protection.

## 3. Start the app

In VS Code choose **Terminal → New Terminal**. Paste this command and press Enter:

```powershell
.\start.cmd
```

The ` .\ ` part means “in this folder.” `start.cmd` is the launcher: it installs
the required packages on first launch, builds the interface, and starts RiftLogs.
The first launch can take a few minutes. Later launches use the same command.

The launcher uses bundled native binaries and checks that SQLite can read and
write before starting. You do not need Python or Visual Studio C++ Build Tools.
It reinstalls dependencies when the package files change or setup verification
fails; your recordings and login profile are not removed. Keep internet available
for that reinstall. If a dependency changes to require an installation script,
setup stops for review rather than silently skipping it.

Chrome should open **http://127.0.0.1:5173**. This address points to your own
computer, not a public website. If Chrome does not open automatically, paste that
address into Chrome yourself. Keep the terminal running while using RiftLogs.

The terminal offers:

```text
[Enter/R] Record a match   [L] Login   [Q] Quit:
```

**Just watching a file? Leave this prompt alone and use the browser.** You do not
need to choose Login. Pressing Enter at this menu starts recording setup.

## 4. Watch a shared replay

1. Save the shared `.riftlogs-replay.json.gz` file anywhere on your computer.
   **Do not unzip it**; RiftLogs opens it directly.
2. In the browser choose **Recorded replays**.
3. Choose **Open replay file**, then select the shared file.
4. Use **Next**, **Previous**, or the **Step** dropdown to move through the match.
   If the recording contains multiple games, use the **Game** dropdown.
5. **Flip board** changes which player's side is at the bottom.

Opening a file does not upload it or add it to recording history. Reopen the file
after refreshing the page. Card artwork loads online; unavailable artwork falls
back to text. Local board experiments do not rewrite the replay file.

When finished, type **Q** at the terminal menu and press Enter. The browser tab
may remain open, but the local app has stopped.

## 5. Record a match (optional)

You need your own RiftAtlas spectator account and the match's room code. For
recording your own game, use a second account as the spectator. The other players
should know you are recording and may share the replay.

### Sign in once

1. At the terminal menu type **L** and press Enter.
2. A separate Chrome window opens for the recorder. Sign into your own RiftAtlas
   account there and complete any security checks manually.
3. Close **all windows belonging to that dedicated login profile**. Your normal
   Chrome windows and the RiftLogs viewer can stay open.
4. Return to the terminal and press Enter when prompted.

RiftLogs keeps that browser session locally so you usually do not need to sign
in for every match. It does not ask for your password in the terminal. Do not
share its browser profile folder with anyone.

### Join and record

1. Type **R** at the terminal menu and press Enter.
2. Enter the room code when asked. RiftLogs opens the spectator browser and
   attempts to join automatically.
3. Wait for **Recording live capture #…** and **Compact board recording active**.
   An open browser alone does not mean recording has started.
4. Keep the spectator browser open for the match. Join before setup if possible:
   Atlas retains only its most recent log events, so joining late may miss history.
5. After the match, type **stop** in the terminal and press Enter.
6. Wait for **completed and saved** and **Shared replay saved:** with the file
   location. Do not close the spectator browser yourself while it is saving.

In the viewer choose **Recorded replays → Refresh recordings**, then select your
capture. The terminal returns to the menu: choose **R** for another match or **Q**
to stop RiftLogs.

## 6. Find and share your recording

A successfully completed recording automatically produces a file like:

```text
RiftLogs\exports\capture-12.riftlogs-replay.json.gz
```

Send **that file** to your friend. They open it using section 4. The capture number
will differ on each computer. Player names and visible gameplay are included;
the file is not anonymous. It contains image links, not the image files themselves.

Original recording data stays in `riftlogs.db` for debugging. The compressed
export does not shrink that database. Do not send your entire RiftLogs folder:
it may contain personal recordings and a signed-in browser session. In particular,
never share `.riftlogs-spectator-profile` or `.playwright-profile`.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| `start.cmd` is not recognized | Open the extracted folder containing `start.cmd`, then open a new terminal there. Use `.\start.cmd`, including the dot and backslash. |
| Node is missing or the wrong version | Install Node.js **24**, then close and reopen VS Code. |
| Automatic prerequisite installation is unavailable | Install/update **App Installer** from Microsoft Store to get WinGet, or install Node.js 24 and Chrome manually using the links above. |
| Setup or build failed | Keep the error text and send it to the person helping you. Do not disable security tools or run random repair commands. |
| `node-gyp` asks for Visual Studio / C++ tools | Your copy may have the old launcher. Update to the fixed preview branch and run `.\start.cmd` again. Do not install a compiler just for RiftLogs. |
| Port 5173 is already in use | Quit the other RiftLogs instance. Do not run the launcher and `npm run dev` together. |
| Browser profile already in use | Close the dedicated spectator/login windows, then retry. Do not delete the profile. |
| Login expired or a security check appears | Return to the menu and choose **L** to sign in manually. If checks still fail, stop and report it; there is no supported bypass. Shared-file playback still works. |
| Waiting for the match log / timeout | Check the room code and that the browser reached the spectator match. Open the match's log panel if needed, then retry. |
| Recording says interrupted | Previously saved data remains in history, but the final state may be missing. Interrupted recordings do not automatically produce a completed sharing file. Next time use `stop` and wait. |
| Recording saved but export failed | The original is safe. Save the error and the retry command printed by the terminal and ask for help. |
| Invalid or oversized shared replay | Make sure this is a RiftLogs shared replay, not a raw Atlas/full-DOM research log. Ask the sender for a fresh export. |
| Images are missing | Check your internet connection. Old recordings may lack image links, or the artwork service may be unavailable. Text playback should still work. |
| Page no longer loads | The terminal may have stopped. Start RiftLogs again with `.\start.cmd`. |

Prefer `stop` over Ctrl+C when recording. If you have already used Ctrl+C and
Windows asks **Terminate batch job (Y/N)?**, wait for any save message, then choose
**Y** to end the launcher. An interrupted recording may be incomplete.

## Preview limitations and reporting a problem

Replays follow observed board updates, which may not align exactly with each
individual action. Unknown intervals and ambiguous rewinds can show warnings.
Hidden information is not recovered, and the trash view may show only its top
card. This is not a complete rules engine or statistics dashboard yet.

When reporting a problem, include the branch/release you downloaded, what you
were doing, the error text, and the replay step number if relevant. Share a replay
only if you are comfortable sharing its player names and gameplay. Never send
passwords or your browser profile.

Before distributing this preview widely, test both a fresh installation and a
full record → stop → open shared file workflow on that installation.
