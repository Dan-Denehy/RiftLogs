import type { CompactObservation, CompactLogEntry } from "./boardObservation.ts";
import { allSections, type BoardState, type ReplayStep } from "./stateContext.ts";

export type RecordedGame = { number: number; room: string | null; steps: ReplayStep[]; warnings: string[] };

// Presentation only: retain all raw steps and never move a later state onto an earlier action.
export function importantReplaySteps(steps: ReplayStep[]): ReplayStep[] {
  const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  const signature = (state: BoardState) => canonical({
    ...state, battlefieldImages: undefined,
    cards: state.cards?.map(({ imageUrl, imageFallbackUrl, ...card }) => card).sort((a, b) => a.id.localeCompare(b.id)) ?? null,
    battlefieldMight: state.battlefieldMight?.map(({ zone, playerId, value }) => ({ zone, playerId, value }))
      .sort((a, b) => canonical(a).localeCompare(canonical(b))),
  });
  const result: ReplayStep[] = [];
  let previousObservation: string | undefined;
  for (const step of steps) {
    if (step.superseded) continue;
    if (step.observationSequence == null) { result.push(step); continue; }
    const current = signature(step.state);
    const rewind = step.action.text.startsWith("Rewind/reset checkpoint");
    if (previousObservation === undefined || current !== previousObservation || rewind || step.flags.length) {
      const text = rewind ? "Rewind/reset" : previousObservation === undefined ? "Initial recorded position" : "Board updated";
      result.push({ ...step, action: { ...step.action, text } });
    }
    previousObservation = current;
  }
  return result;
}

// A suffix/prefix overlap preserves occurrence counts, unlike a Set of action text.
export function newLogEntries(previous: CompactLogEntry[], current: CompactLogEntry[]) {
  let overlap = Math.min(previous.length, current.length);
  while (overlap && !previous.slice(-overlap).every((entry, i) => entry.key === current[i].key)) overlap--;
  return { entries: current.slice(overlap), gap: previous.length > 0 && current.length > 0 && overlap === 0 };
}

export function compactBoundary(previous: CompactObservation | undefined, current: CompactObservation): string | null {
  if (!previous) return "initial";
  if (current.metadata.room !== previous.metadata.room) return "room-change";
  if (current.metadata.resetToken !== previous.metadata.resetToken) return "reset-or-rewind";
  if (current.metadata.authoritativeSequence != null && previous.metadata.authoritativeSequence != null &&
      current.metadata.authoritativeSequence < previous.metadata.authoritativeSequence) return "reset-or-rewind";
  if (current.metadata.phase !== previous.metadata.phase) return "phase-change";
  if (JSON.stringify(current.state.context) !== JSON.stringify(previous.state.context)) return "turn-boundary";
  const { entries } = newLogEntries(previous.logs, current.logs);
  if (entries.some((entry) => /\b(ended? (?:the |their )?turn|turn ended|start(?:ed)? (?:the |their )?turn|began .*turn)\b/i.test(entry.text.replace(/^\d{1,2}:\d{2}\s*/, "")))) return "turn-boundary";
  return null;
}

// Persist changed sections only; initial/turn/reset checkpoints always contain all sections.
// This changes the capture format, never previously saved observations.
export function compactDelta(previous: CompactObservation | undefined, current: CompactObservation): CompactObservation | null {
  const reason = compactBoundary(previous, current);
  const sections = reason ? [...allSections] : allSections.filter((key) => JSON.stringify(previous?.state[key]) !== JSON.stringify(current.state[key]));
  if (!sections.includes("cards") && JSON.stringify(previous?.state.battlefieldMight) !== JSON.stringify(current.state.battlefieldMight)) sections.push("cards");
  if (!sections.includes("cards") && JSON.stringify(previous?.state.battlefieldNames) !== JSON.stringify(current.state.battlefieldNames)) sections.push("cards");
  if (!sections.includes("cards") && JSON.stringify(previous?.state.battlefieldImages) !== JSON.stringify(current.state.battlefieldImages)) sections.push("cards");
  if (!sections.includes("cards") && JSON.stringify(previous?.state.chain) !== JSON.stringify(current.state.chain)) sections.push("cards");
  const metaChanged = JSON.stringify(previous?.metadata) !== JSON.stringify(current.metadata);
  const logsChanged = JSON.stringify(previous?.logs) !== JSON.stringify(current.logs);
  if (!sections.length && !metaChanged && !logsChanged && JSON.stringify(previous?.state.players) === JSON.stringify(current.state.players)) return null;
  const result = structuredClone(current);
  result.sections = sections;
  result.reason = reason ?? "change";
  if (!sections.includes("cards")) result.state.cards = null;
  if (!sections.includes("cards")) delete result.state.battlefieldMight;
  if (!sections.includes("cards")) delete result.state.battlefieldNames;
  if (!sections.includes("cards")) delete result.state.battlefieldImages;
  if (!sections.includes("cards")) delete result.state.chain;
  if (!sections.includes("scores")) result.state.scores = {};
  if (!sections.includes("resources")) result.state.resources = {};
  return result;
}

const emptyState = (): BoardState => ({ context: { turn: null, activePlayerId: null }, players: {}, scores: {}, resources: {}, cards: null });

// Observational replay: do not assign a later board snapshot to earlier actions.
// Logs in a batch get individual steps, followed by the actual observed position.
export function buildRecordedReplay(observations: CompactObservation[]): RecordedGame[] {
  const games: RecordedGame[] = [];
  let state = emptyState();
  let previous: CompactObservation | undefined;
  let game: RecordedGame | undefined;
  let hasPlayed = false;
  let expandedSteps = 0;
  let expandedCards = 0;
  let activeLogs: { key: string; stepIndex: number }[] = [];
  const isRewindLog = (entry: CompactLogEntry) => /\brewound to before\b/i.test(entry.text);
  const openingWarning = "Opening setup was not observed; this recording may begin mid-game.";
  for (const observation of observations) {
    if (previous && observation.sequence <= previous.sequence) throw new Error("Board observations must be in increasing sequence order.");
    const meta = observation.metadata;
    if (!meta.room) continue; // Lobby/loading DOM is not an empty game board.
    const roomChanged = !!previous && previous.metadata.room !== meta.room;
    // Explicit next-game setup is stronger evidence than a reset token or turn rollback.
    // Include setup in the NEXT game rather than leaving it at the end of the previous one.
    const restartedInSameRoom = hasPlayed && ["sideboarding", "battlefield_pick"].includes(meta.phase ?? "");
    if (!game || roomChanged || restartedInSameRoom) {
      game = { number: games.length + 1, room: meta.room, steps: [], warnings: [] };
      games.push(game); state = emptyState(); previous = undefined; hasPlayed = false;
      activeLogs = [];
    }
    if (observation.reason?.includes("sampled-source") && !game.warnings.includes("Sampled DOM source: intermediate board changes may be missing.")) {
      game.warnings.push("Sampled DOM source: intermediate board changes may be missing.");
    }
    if (meta.phase === "in_game") hasPlayed = true;
    const rewound = !!previous && (
      (meta.resetToken != null && previous.metadata.resetToken != null && meta.resetToken !== previous.metadata.resetToken) ||
      (meta.authoritativeSequence != null && previous.metadata.authoritativeSequence != null && meta.authoritativeSequence < previous.metadata.authoritativeSequence)
    );
    const recovered = newLogEntries(previous?.logs ?? [], observation.logs);
    let replacementEntries: CompactLogEntry[] = [];
    if (rewound) {
      const retained = observation.logs.filter((entry) => !isRewindLog(entry));
      // Match occurrences in order, not a set of text. Repeated draws remain distinct.
      let longest = 0;
      let matches: number[] = [];
      for (let start = 0; start < activeLogs.length; start++) {
        let length = 0;
        while (length < retained.length && activeLogs[start + length]?.key === retained[length].key) length++;
        if (length > longest) { longest = length; matches = [start]; }
        else if (length && length === longest) matches.push(start);
      }
      if (longest && matches.length === 1) {
        const end = matches[0] + longest;
        const lastKeptStep = activeLogs[end - 1].stepIndex;
        for (let i = lastKeptStep + 1; i < game.steps.length; i++) game.steps[i].superseded = true;
        activeLogs = activeLogs.slice(0, end);
        replacementEntries = retained.slice(longest);
        game.warnings.push(`Observation ${observation.sequence}: rewind/reset; superseded actions and checkpoints are hidden in normal playback and retained for debugging.`);
      } else {
        game.warnings.push(`Observation ${observation.sequence}: rewind/reset target could not be matched uniquely; earlier actions retained to avoid removing valid history.`);
      }
    }
    const sawSetup = ["mulligan", "battlefield_pick"].includes(meta.phase ?? "") ||
      observation.logs.some((row) => /mulligan|battlefield.*lock|locked.*battlefield|initiative/i.test(row.text));
    if (!previous && !sawSetup) game.warnings.push(openingWarning);
    // A recording can start on an empty sideboarding page before setup appears.
    if (sawSetup) game.warnings = game.warnings.filter((warning) => warning !== openingWarning);
    if (recovered.gap && !rewound) game.warnings.push(`Observation ${observation.sequence}: no retained-log overlap; events may be missing.`);
    const append = (text: string, next: BoardState, observed: boolean, note: string, actorId?: string | null) => {
      expandedCards += (next.cards?.length ?? 0) + (state.cards?.length ?? 0);
      if (++expandedSteps > 15_000 || expandedCards > 1_000_000) throw new Error("Replay expansion limit exceeded.");
      const time = !observed ? text.match(/^(\d{1,2}:\d{2})(.*)$/) : null;
      game!.steps.push({ action: { kind: "unknown", sequence: game!.steps.length + 1, text: time ? time[2].trim() : text, ...(actorId ? { actorId } : {}) },
        state: structuredClone(next), predicted: structuredClone(state),
        flags: observed ? [] : [{ path: "timing.postActionBoard", expected: "State immediately after this action", observed: null, status: "unable-to-verify" }],
        observationSequence: observed ? observation.sequence : null, verifiedPaths: [], note, ...(time ? { timestamp: time[1] } : {}) });
    };
    // Rewind logs may re-show the old retained history: don't append it as new actions.
    if (!rewound) for (const row of recovered.entries.filter((entry) => !isRewindLog(entry))) {
      activeLogs.push({ key: row.key, stepIndex: game.steps.length });
      append(row.text, state, false,
        "Log event only. Board shows the previous observation, not a verified post-action position. Several actions may share one observation.", row.actorId);
    }
    const next = structuredClone(state);
    for (const section of observation.sections) {
      if (section === "cards") {
        next.cards = structuredClone(observation.state.cards);
        next.battlefieldMight = structuredClone(observation.state.battlefieldMight ?? []);
        next.battlefieldNames = structuredClone(observation.state.battlefieldNames ?? {});
        next.battlefieldImages = structuredClone(observation.state.battlefieldImages ?? {});
        next.chain = structuredClone(observation.state.chain ?? null);
      }
      if (section === "context") next.context = structuredClone(observation.state.context);
      if (section === "scores") next.scores = structuredClone(observation.state.scores);
      if (section === "resources") next.resources = structuredClone(observation.state.resources);
    }
    next.players = { ...observation.state.players };
    // Keep the observed replacement branch visible, but do not claim this batch
    // snapshot is the exact intermediate state after each recovered action.
    for (const row of replacementEntries) {
      activeLogs.push({ key: row.key, stepIndex: game.steps.length });
      append(row.text, next, false, "Rewind batch: showing the board captured with this replacement branch, not a verified position immediately after this action. Intermediate action timing is unknown.", row.actorId);
    }
    // Only visible cards replace the visible-board view; absent cards are NOT moved to trash.
    append(`${rewound ? "Rewind/reset checkpoint" : observation.reason === "turn-boundary" ? "Turn-boundary checkpoint" : "Observed board"} · ${observation.capturedAt}`, next, true,
      `${observation.sections.length === 4 ? "Full" : "Targeted"} observation (${observation.sections.join(", ") || "log/metadata"}). Visible cards only; trash is top-card-only, hand identities and attachments are not inferred. No action-level timing or rule validation is claimed.`);
    state = next;
    previous = observation;
  }
  return games;
}
