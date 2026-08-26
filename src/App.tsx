import {
  useEffect,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import {
  analyzeCaptureCompleteness,
  parseAtlasCapture,
  parseLiveAtlasEvents,
  type DisplayAction,
  type DisplayTurn,
} from "./atlasCapture";

type ApiStatus = "checking" | "connected" | "unavailable";

type ImportState =
  | { kind: "idle" }
  | { kind: "saving"; message: string }
  | { kind: "saved"; message: string }
  | { kind: "error"; message: string };

type LiveCaptureSummary = {
  id: number;
  roomId: string;
  status: string;
  eventCount: number;
  startedAt: string;
  endedAt: string | null;
};

export default function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
  const [turns, setTurns] = useState<DisplayTurn[] | null>(null);
  const [importState, setImportState] = useState<ImportState>({ kind: "idle" });
  const [liveCaptures, setLiveCaptures] = useState<LiveCaptureSummary[]>([]);
  const [selectedCaptureId, setSelectedCaptureId] = useState<number | null>(null);
  const [historyMessage, setHistoryMessage] = useState("Loading recordings…");

  useEffect(() => {
    fetch("/api/health")
      .then((response) => {
        if (!response.ok) throw new Error("API health check failed");
        return response.json();
      })
      .then(() => setApiStatus("connected"))
      .catch(() => setApiStatus("unavailable"));

    fetch("/api/live-captures")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load capture history.");
        return (await response.json()) as LiveCaptureSummary[];
      })
      .then((captures) => {
        setLiveCaptures(captures);
        setHistoryMessage(
          captures.length === 0 ? "No live recordings saved yet." : "",
        );
        if (captures[0]) void openLiveCapture(captures[0].id);
      })
      .catch((error: unknown) =>
        setHistoryMessage(
          error instanceof Error ? error.message : "Could not load history.",
        ),
      );
  }, []);

  async function openLiveCapture(captureId: number) {
    setSelectedCaptureId(captureId);
    setHistoryMessage(`Loading live capture #${captureId}…`);

    try {
      const response = await fetch(`/api/live-captures/${captureId}`);
      const result = (await response.json()) as {
        events?: Array<{ captureSequence: number; rawJson: string }>;
        error?: string;
      };
      if (!response.ok || !result.events) {
        throw new Error(result.error ?? "Could not load this live capture.");
      }

      const interpretedTurns = parseLiveAtlasEvents(result.events);
      setTurns(interpretedTurns);
      setImportState({ kind: "idle" });
      setHistoryMessage(
        `Showing live capture #${captureId}: ${result.events.length} raw events interpreted.`,
      );
    } catch (error) {
      setTurns(null);
      setHistoryMessage(
        error instanceof Error ? error.message : "Could not interpret capture.",
      );
    }
  }

  async function importCapture(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportState({ kind: "saving", message: "Reading and saving capture…" });

    try {
      const rawJson = await file.text();
      const parsed = parseAtlasCapture(rawJson);

      const response = await fetch("/api/atlas-captures", {
        method: "POST",
        headers: {
          "content-type": "application/vnd.riftlogs.atlas+json",
          "x-riftlogs-filename": encodeURIComponent(file.name),
        },
        body: rawJson,
      });
      const result = (await response.json()) as {
        captureId?: number;
        error?: string;
      };

      if (!response.ok || result.captureId === undefined) {
        throw new Error(result.error ?? "The API could not save this capture.");
      }

      setTurns(parsed.turns);
      setImportState({
        kind: "saved",
        message: `Raw capture saved unchanged as import #${result.captureId}.`,
      });
    } catch (error) {
      setTurns(null);
      setImportState({
        kind: "error",
        message: error instanceof Error ? error.message : "Import failed.",
      });
    } finally {
      event.target.value = "";
    }
  }

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">RiftAtlas match analysis</p>
          <h1>RiftLogs</h1>
          <p className="lede">
            Record RiftAtlas matches live, preserve every raw event, and retrace
            each match turn by turn.
          </p>
        </div>
        <div className={`status status--${apiStatus}`}>
          <span aria-hidden="true" />
          API: {apiStatus}
        </div>
      </header>

      <section className="history-panel" aria-labelledby="history-heading">
        <div>
          <p className="step">SQLite capture history</p>
          <h2 id="history-heading">Recorded matches</h2>
          {historyMessage ? <p className="history-message">{historyMessage}</p> : null}
        </div>
        {liveCaptures.length > 0 ? (
          <div className="capture-list">
            {liveCaptures.map((capture) => (
              <button
                className={capture.id === selectedCaptureId ? "capture-button capture-button--active" : "capture-button"}
                key={capture.id}
                onClick={() => void openLiveCapture(capture.id)}
                type="button"
              >
                <strong>Capture #{capture.id}</strong>
                <span>Room {capture.roomId}</span>
                <small>{capture.eventCount} events · {capture.status}</small>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="import-panel" aria-labelledby="import-heading">
        <div>
          <p className="step">Optional diagnostic fallback</p>
          <h2 id="import-heading">Import an older Atlas JSON capture</h2>
          <p>
            Use this only for an existing <code>atlas-match.json</code> file.
            New matches recorded by the spectator appear automatically in
            Recorded matches above.
          </p>
        </div>
        <label className="file-button">
          Select atlas-match.json
          <input type="file" accept=".json,application/json" onChange={importCapture} />
        </label>
        {importState.kind !== "idle" && (
          <p className={`import-message import-message--${importState.kind}`}>
            {importState.message}
          </p>
        )}
      </section>

      {turns ? <EventLog turns={turns} /> : <EmptyLog />}
    </main>
  );
}

function EventLog({ turns }: { turns: DisplayTurn[] }) {
  const actionCount = turns.reduce(
    (total, turn) => total + turn.actions.length,
    0,
  );
  const numberedTurns = turns
    .map((turn) => Number(turn.turnNumber))
    .filter(Number.isFinite);
  const firstTurnNumber = numberedTurns.length ? Math.min(...numberedTurns) : null;
  const completeness = analyzeCaptureCompleteness(turns);

  return (
    <section className="event-log" aria-labelledby="event-log-heading">
      <header className="log-heading">
        <div>
          <p className="step">Raw capture preview</p>
          <h2 id="event-log-heading">Turn-by-turn event log</h2>
        </div>
        <p>{turns.length} turns · {actionCount} actions</p>
      </header>

      {firstTurnNumber !== null && firstTurnNumber > 1 ? (
        <p className="capture-warning">
          This capture starts at turn {firstTurnNumber}. Turns 1–{firstTurnNumber - 1}
          {" "}were not present in the saved RiftAtlas DOM.
        </p>
      ) : null}

      {!completeness.initiatingPhaseCaptured ? (
        <p className="capture-warning">
          The initiating phase is not present. RiftLogs could not find retained
          battlefield-selection or mulligan text, so events before the first saved
          action may be missing even if turn 1 is displayed.
        </p>
      ) : null}

      {turns.map((turn, turnIndex) => (
        <article
          className={`turn turn--${turn.playerTone}`}
          key={`${turn.sequence ?? turnIndex}-${turnIndex}`}
        >
          <h3>
            {turn.turnNumber === null ? "Setup" : `Turn ${turn.turnNumber}`}
            {turn.turnPlayerName ? <small>{turn.turnPlayerName}</small> : null}
          </h3>
          {turn.actions.length > 0 ? (
            <ol>
              {turn.actions.map((action, actionIndex) => (
                <li
                  className={`action action--${action.actorResolution}`}
                  key={`${action.sequence ?? actionIndex}-${actionIndex}`}
                  style={
                    action.actorMarkerColor
                      ? ({
                          "--actor-color": action.actorMarkerColor,
                        } as CSSProperties)
                      : undefined
                  }
                >
                  <span className="sequence">
                    #{action.sequence ?? actionIndex + 1}
                  </span>
                  <div>
                    <span className="actor">
                      {action.actorPlayerName ?? "Unknown actor"}
                    </span>
                    <p>{actionLabel(action)}</p>
                    {action.timestamp ? (
                      <time className="action-time">{action.timestamp}</time>
                    ) : null}
                    {action.battlefieldMarkers?.length ? (
                      <small>
                        Battlefield: {action.battlefieldMarkers
                          .map(({ marker }) => marker)
                          .filter(Boolean)
                          .join(", ")}
                      </small>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No action elements were detected in this turn.</p>
          )}
        </article>
      ))}
    </section>
  );
}

function EmptyLog() {
  return (
    <section className="empty-log">
      <p>No match selected yet.</p>
      <small>Select a recorded match above or import an Atlas JSON capture.</small>
    </section>
  );
}

function actionLabel(action: DisplayAction) {
  const text = action.text.trim();
  if (text) return text;

  const cards = action.cards?.map(({ name }) => name).filter(Boolean);
  if (cards?.length) return cards.join(", ");

  return "Captured action";
}
