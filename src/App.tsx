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
import {
  findHiddenCardRevealCandidates,
  reconstructMatchState,
  type MatchStateSnapshot,
} from "./matchState";

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
  const [hiddenCardReveals, setHiddenCardReveals] = useState<Record<number, string>>({});
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
        hiddenCardReveals?: Array<{ actionSequence: number; hiddenCardId: string }>;
        match?: { id: number; participants: Array<{ displayName: string }> };
        error?: string;
      };
      if (!response.ok || !result.events) {
        throw new Error(result.error ?? "Could not load this live capture.");
      }

      const interpretedTurns = parseLiveAtlasEvents(result.events);
      setTurns(interpretedTurns);
      setHiddenCardReveals(
        Object.fromEntries(
          (result.hiddenCardReveals ?? []).map((reveal) => [
            reveal.actionSequence,
            reveal.hiddenCardId,
          ]),
        ),
      );
      setImportState({ kind: "idle" });
      setHistoryMessage(
        `Showing live capture #${captureId}: ${result.events.length} raw events interpreted.` +
          (result.match
            ? ` Saved match #${result.match.id}. Players: ${result.match.participants.map((player) => player.displayName).join(", ") || "not yet identified"}.`
            : ""),
      );
    } catch (error) {
      setTurns(null);
      setHistoryMessage(
        error instanceof Error ? error.message : "Could not interpret capture.",
      );
    }
  }

  async function saveHiddenCardReveal(
    actionSequence: number,
    hiddenCardId: string,
  ) {
    setHiddenCardReveals((current) => ({
      ...current,
      [actionSequence]: hiddenCardId,
    }));
    if (selectedCaptureId === null) return;

    const response = await fetch(
      `/api/live-captures/${selectedCaptureId}/hidden-card-reveal`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionSequence, hiddenCardId }),
      },
    );
    if (!response.ok) {
      setHistoryMessage("Could not save the hidden-card correction.");
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
      setSelectedCaptureId(null);
      setHiddenCardReveals({});
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

      {turns ? (
        <EventLog
          turns={turns}
          hiddenCardReveals={hiddenCardReveals}
          onHiddenCardReveal={saveHiddenCardReveal}
        />
      ) : <EmptyLog />}
    </main>
  );
}

function EventLog({
  turns,
  hiddenCardReveals,
  onHiddenCardReveal,
}: {
  turns: DisplayTurn[];
  hiddenCardReveals: Record<number, string>;
  onHiddenCardReveal: (actionSequence: number, hiddenCardId: string) => void;
}) {
  const actionCount = turns.reduce(
    (total, turn) => total + turn.actions.length,
    0,
  );
  const numberedTurns = turns
    .map((turn) => Number(turn.turnNumber))
    .filter(Number.isFinite);
  const firstTurnNumber = numberedTurns.length ? Math.min(...numberedTurns) : null;
  const completeness = analyzeCaptureCompleteness(turns);
  const stateByAction = reconstructMatchState(turns, { hiddenCardReveals });
  const hiddenRevealCandidates = findHiddenCardRevealCandidates(
    turns,
    stateByAction,
  );
  const turnCount = new Set(numberedTurns).size;

  return (
    <section className="event-log" aria-labelledby="event-log-heading">
      <header className="log-heading">
        <div>
          <p className="step">Interpreted match timeline</p>
          <h2 id="event-log-heading">Turn-by-turn event log</h2>
        </div>
        <p>{turnCount} turns · {actionCount} actions</p>
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

      {hiddenRevealCandidates.length > 0 ? (
        <section className="manual-corrections" aria-labelledby="hidden-card-heading">
          <p className="step">Manual match information</p>
          <h3 id="hidden-card-heading">Resolve hidden cards</h3>
          <p>
            These chain resolutions had no matching played-card event. Choose a
            hidden card only when you know it was revealed from that position.
          </p>
          {hiddenRevealCandidates.map((candidate) => (
            <fieldset key={candidate.actionSequence}>
              <legend>
                After #{candidate.actionSequence}, was {candidate.cardName} one of
                these hidden cards?
              </legend>
              {candidate.hiddenCards.map((card) => (
                <button
                  className={
                    hiddenCardReveals[candidate.actionSequence] === card.id
                      ? "manual-choice manual-choice--selected"
                      : "manual-choice"
                  }
                  key={card.id}
                  onClick={() => onHiddenCardReveal(candidate.actionSequence, card.id)}
                  type="button"
                >
                  {card.location} (placed at #{card.placedAtSequence})
                </button>
              ))}
            </fieldset>
          ))}
        </section>
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
                    <ActionState snapshot={stateByAction.get(action.sequence)} />
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

function ActionState({ snapshot }: { snapshot?: MatchStateSnapshot }) {
  if (!snapshot) return null;

  return (
    <details className="action-state">
      <summary>State after this action</summary>
      {snapshot.runeCheckpoint ? (
        <p className="rune-checkpoint">
          {snapshot.runeCheckpoint.phase === "start"
            ? `${snapshot.runeCheckpoint.playerName} starts the turn with ${snapshot.runeCheckpoint.totalRunes} runes total (all ready).`
            : `${snapshot.runeCheckpoint.playerName} ends the turn with ${snapshot.runeCheckpoint.readyRunes} runes up, ${snapshot.runeCheckpoint.totalRunes} runes total.`}
        </p>
      ) : null}
      <div className="state-players">
        {snapshot.players.map((player) => (
          <section key={player.playerId ?? player.playerName}>
            <h4>{player.playerName}</h4>
            <p><strong>{player.points}</strong> points · <strong>{player.units.length}</strong> confirmed units</p>
            {player.units.length > 0 ? (
              <ul>
                {player.units.map((unit) => (
                  <li key={unit.id}>
                    {unit.name} <small>{unit.location}</small>
                    {unit.equipment.length > 0 ? (
                      <small> · Equipped: {unit.equipment.join(", ")}</small>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {player.hiddenCards.length > 0 ? (
              <ul>
                {player.hiddenCards.map((card) => (
                  <li key={card.id}>
                    {card.name ?? "Hidden card"} <small>{card.location}</small>
                  </li>
                ))}
              </ul>
            ) : null}
            {player.unclassifiedBaseCards.length > 0 ? (
              <p className="state-uncertain">
                Unclassified at base: {player.unclassifiedBaseCards.join(", ")}
              </p>
            ) : null}
          </section>
        ))}
      </div>
      {snapshot.warnings.length > 0 ? (
        <p className="state-uncertain">{snapshot.warnings.at(-1)}</p>
      ) : null}
    </details>
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
