import { useEffect, useState } from "react";
import ReplayViewer from "./ReplayViewer";
import { importantReplaySteps, type RecordedGame } from "./recordedReplay";
import { openSharedReplay } from "./sharedReplay";

type Capture = { id: number; roomId: string; status: string; observationCount: number };

export default function RecordedReplayViewer() {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [captureId, setCaptureId] = useState("");
  const [games, setGames] = useState<RecordedGame[]>([]);
  const [gameIndex, setGameIndex] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [debugSteps, setDebugSteps] = useState(false);
  const [shared, setShared] = useState<{ name: string; games: RecordedGame[]; version: number } | null>(null);
  const [opening, setOpening] = useState(false);
  const [fileError, setFileError] = useState("");
  async function openFile(file: File) {
    setOpening(true); setFileError("");
    try {
      const imported = await openSharedReplay(file);
      setShared((previous) => ({ name: file.name, games: imported, version: (previous?.version ?? 0) + 1 }));
      setGameIndex(0); setDebugSteps(false);
    } catch (reason) {
      setFileError(reason instanceof Error ? reason.message : "Could not open replay.");
    } finally { setOpening(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/board-replays", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Could not load recorded replays.");
      setCaptures(await response.json());
    }).catch((reason) => { if (!controller.signal.aborted) setError(String(reason)); });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    setGames([]); setGameIndex(0); setError(""); setLoading(false);
    if (!captureId) return;
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/board-replays/${captureId}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.error === "string" ? body.error : "Could not load this replay.");
      }
      const result = await response.json(); setGames(result.games);
    }).catch((reason) => { if (!controller.signal.aborted) setError(String(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [captureId, refresh]);
  const displayedGames = shared?.games ?? games;
  const game = displayedGames[gameIndex];
  const visibleSteps = game ? (debugSteps ? game.steps : importantReplaySteps(game.steps)) : [];
  return <>
    <section className="replay-shell recorded-controls">
      <h1>Recorded replays</h1>
      <label>Open replay file <input type="file" aria-label="Open replay file" accept=".gz,.json" disabled={opening}
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void openFile(file); }} /></label>
      <p>Shared files open locally, without being uploaded or added to history. Reopen the file after refreshing.</p>
      {opening && <p role="status">Opening shared replay…</p>}
      {fileError && <p role="alert">{fileError}</p>}
      {shared && <p>Playing file: {shared.name} <button disabled={opening} onClick={() => { setShared(null); setGameIndex(0); }}>Return to recordings</button></p>}
      <p>Compact board observations with retained log events. Unknown intervals are labelled; older log-only captures cannot supply past board positions.</p>
      <label>Capture <select disabled={opening} aria-label="Recorded capture" value={shared ? "" : captureId} onChange={(event) => { setShared(null); setGameIndex(0); setCaptureId(event.target.value); }}>
        <option value="">Select a capture</option>
        {captures.map((capture) => <option key={capture.id} value={capture.id}>#{capture.id} · {capture.roomId} · {capture.observationCount} observations · {capture.status}</option>)}
      </select></label>{" "}<button onClick={() => setRefresh((value) => value + 1)}>Refresh recordings</button>
      {!captures.length && !shared && <p>No local recordings yet. Open a shared replay file above, or run the spectator to record a match.</p>}
      {!shared && loading && <p role="status">Loading replay…</p>}{!shared && error && <p role="alert">{error}</p>}
      {!!displayedGames.length && <label> Game <select aria-label="Recorded game" value={gameIndex} onChange={(event) => setGameIndex(Number(event.target.value))}>
        {displayedGames.map((item, i) => <option key={i} value={i}>Game {item.number} · {item.room}</option>)}
      </select></label>}
      {game && !!game.warnings.length && <details><summary>{game.warnings.length} capture warnings</summary><ul>{game.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
      {game && <p><label><input type="checkbox" checked={debugSteps} onChange={(event) => setDebugSteps(event.target.checked)} /> Show all checkpoints (debug)</label>
        {!debugSteps && <> · {game.steps.length - visibleSteps.length} routine or superseded steps hidden. Current-branch gameplay actions and board changes remain visible.</>}</p>}
    </section>
    {game && !!visibleSteps.length && <ReplayViewer key={`${shared ? `file-${shared.version}` : captureId}:${gameIndex}:${refresh}:${debugSteps}`} replay={visibleSteps} recorded title={`Game ${game.number} · ${game.room}`} />}
  </>;
}
