export type Section = "context" | "scores" | "resources" | "cards";
export const allSections: Section[] = ["context", "scores", "resources", "cards"];
export type ResourceState = { ready: number | null; used: number | null; hand: number | null; deck: number | null };
export type BoardCard = {
  cardType?: "unit" | "equipment" | "unknown";
  id: string; name: string | null; ownerId: string; zone: string;
  hidden: boolean | null; exhausted: boolean | null; attachedTo: string | null;
};

// Ordinary board movement exhausts the moving unit. Zone transfers such as
// returning to hand or trashing a card are separate from board movement.
export function isBoardMove(from: string, to: string): boolean {
  const isBoard = (zone: string) => zone === "base" || zone.startsWith("battlefield");
  return from !== to && isBoard(from) && isBoard(to);
}
export type BoardState = {
  context: { turn: number | null; activePlayerId: string | null };
  players: Record<string, string>;
  scores: Record<string, number | null>;
  resources: Record<string, ResourceState>;
  turnActivity?: Record<string, { cardsGained: number; runesRecycled: number }>;
  // null means this area could not be read; [] means a confirmed empty board.
  cards: BoardCard[] | null;
};
export type Observation = {
  formatVersion: 1; sequence: number; capturedAt: string;
  sections: Section[]; state: BoardState;
};
export type ReplayAction = { sequence: number; text: string; actorId?: string } & (
  | { kind: "turn-start"; turn: number; playerId: string }
  | { kind: "turn-end" }
  | { kind: "draw"; count: number }
  | { kind: "runes"; readyDelta: number; usedDelta: number }
  | { kind: "recycle"; count: number; from: "ready" | "used" }
  | { kind: "play"; card: BoardCard; fromHand: boolean }
  | { kind: "move"; cardId: string; zone: string }
  | { kind: "attach"; cardId: string; unitId: string }
  | { kind: "score"; amount: number }
  | { kind: "unknown" }
);
export type Flag = { path: string; expected: unknown; observed: unknown; status: "mismatch" | "unable-to-verify" };
export type ReplayStep = {
  action: ReplayAction; state: BoardState; predicted: BoardState;
  flags: Flag[]; observationSequence: number | null; verifiedPaths: string[];
};

export function chooseUpdateSections(action: ReplayAction): Section[] {
  switch (action.kind) {
    case "turn-start": case "turn-end": case "unknown": return [...allSections];
    case "draw": case "runes": case "recycle": return ["resources"];
    case "score": return ["scores"];
    case "play": return ["cards", "resources"];
    default: return ["cards"];
  }
}

export function applyContextAction(previous: BoardState, action: ReplayAction): BoardState {
  const state = structuredClone(previous);
  const resources = action.actorId ? state.resources[action.actorId] : undefined;
  state.turnActivity ??= {};
  for (const id of Object.keys(state.players)) state.turnActivity[id] ??= { cardsGained: 0, runesRecycled: 0 };
  const activity = action.actorId ? state.turnActivity[action.actorId] : undefined;
  const add = (value: number | null, delta: number) => value === null ? null : Math.max(0, value + delta);
  switch (action.kind) {
    case "turn-start": {
      state.context = { turn: action.turn, activePlayerId: action.playerId };
      for (const id of Object.keys(state.players)) state.turnActivity[id] = { cardsGained: 0, runesRecycled: 0 };
      const pool = state.resources[action.playerId];
      if (pool && pool.ready !== null && pool.used !== null) {
        pool.ready += pool.used; pool.used = 0;
      }
      break;
    }
    case "draw":
      if (resources) { resources.hand = add(resources.hand, action.count); resources.deck = add(resources.deck, -action.count); }
      if (activity) activity.cardsGained += action.count;
      break;
    case "recycle":
      if (resources) resources[action.from] = add(resources[action.from], -action.count);
      if (activity) activity.runesRecycled += action.count;
      break;
    case "runes": if (resources) { resources.ready = add(resources.ready, action.readyDelta); resources.used = add(resources.used, action.usedDelta); } break;
    case "play":
      if (state.cards) state.cards.push({ ...structuredClone(action.card), exhausted: action.card.cardType === "unit" ? true : action.card.exhausted });
      if (resources && action.fromHand) resources.hand = add(resources.hand, -1);
      break;
    case "move": {
      const card = state.cards?.find((c) => c.id === action.cardId);
      if (card) {
        const pool = state.resources[card.ownerId];
        if (action.zone === "hand" && card.zone !== "hand") {
          if (pool) pool.hand = add(pool.hand, 1);
          state.turnActivity[card.ownerId].cardsGained++;
        } else if (card.zone === "hand" && action.zone !== "hand" && pool) pool.hand = add(pool.hand, -1);
        if (card.cardType === "unit" && isBoardMove(card.zone, action.zone)) card.exhausted = true;
        card.zone = action.zone;
      }
      break;
    }
    case "attach": { const card = state.cards?.find((c) => c.id === action.cardId); if (card) card.attachedTo = action.unitId; break; }
    case "score": if (action.actorId && state.scores[action.actorId] != null) state.scores[action.actorId]! += action.amount; break;
  }
  return state;
}

// Compare only observed sections. Missing fields cannot erase previous knowledge.
export function reconcileCheckpoint(predicted: BoardState, observation: Observation) {
  const state = structuredClone(predicted);
  const flags: Flag[] = [];
  const verifiedPaths: string[] = [];
  function reconcile(expected: any, observed: any, path: string): any {
    if (observed === null && path.endsWith(".attachedTo")) {
      verifiedPaths.push(path);
      if (expected != null) flags.push({ path, expected, observed, status: "mismatch" });
      return null;
    }
    if (observed === null || observed === undefined) {
      if (expected != null) flags.push({ path, expected, observed: null, status: "unable-to-verify" });
      return structuredClone(expected);
    }
    if (Array.isArray(observed)) {
      // A complete card-list observation is keyed by instance ID, not DOM order/name.
      const old = Array.isArray(expected) ? expected as BoardCard[] : [];
      for (const card of old) if (!observed.some((c: BoardCard) => c.id === card.id)) {
        flags.push({ path: `${path}.${card.id}`, expected: card, observed: "absent", status: "mismatch" });
      }
      return observed.map((card: BoardCard) => reconcile(old.find((c) => c.id === card.id) ?? {}, card, `${path}.${card.id}`));
    }
    if (typeof observed === "object") {
      const result = { ...(expected ?? {}) };
      for (const key of new Set([...Object.keys(expected ?? {}), ...Object.keys(observed)])) {
        result[key] = reconcile(expected?.[key], observed[key], `${path}.${key}`);
      }
      return result;
    }
    verifiedPaths.push(path);
    if (expected !== undefined && expected !== null && expected !== observed) flags.push({ path, expected, observed, status: "mismatch" });
    return observed;
  }
  for (const section of observation.sections) {
    // All assignments use the same section on both typed states.
    Object.assign(state, { [section]: reconcile(predicted[section], observation.state[section], section) });
  }
  state.players = { ...state.players, ...observation.state.players };
  return { state, flags, verifiedPaths };
}

export function diffObservations(previous: Observation | null, next: Observation): Section[] {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return JSON.stringify(value.map(canonical).sort());
    if (value && typeof value === "object") return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return JSON.stringify(value);
  };
  return next.sections.filter((section) => !previous || !previous.sections.includes(section) || canonical(previous.state[section]) !== canonical(next.state[section]) || canonical(previous.state.players) !== canonical(next.state.players));
}

export function buildReplay(initial: BoardState, entries: Array<{ action: ReplayAction; observation?: Observation }>): ReplayStep[] {
  let state = structuredClone(initial);
  let sequence = -1;
  return entries.map(({ action, observation }) => {
    if (action.sequence <= sequence) throw new Error("Replay actions must have increasing sequences.");
    sequence = action.sequence;
    if (observation && observation.sequence !== action.sequence) throw new Error("Observation must be explicitly aligned to this action.");
    if ((action.kind === "turn-start" || action.kind === "turn-end") && (!observation || allSections.some((s) => !observation.sections.includes(s)))) {
      throw new Error("Turn boundaries require a full board observation.");
    }
    const predicted = applyContextAction(state, action);
    const checked = observation ? reconcileCheckpoint(predicted, observation) : { state: predicted, flags: [], verifiedPaths: [] };
    state = checked.state;
    return { action: structuredClone(action), predicted, state: structuredClone(state), flags: checked.flags, verifiedPaths: checked.verifiedPaths, observationSequence: observation?.sequence ?? null };
  });
}

export function getStateAtAction(replay: ReplayStep[], sequence: number): ReplayStep | null {
  const step = replay.find((item) => item.action.sequence === sequence);
  return step ? structuredClone(step) : null;
}
