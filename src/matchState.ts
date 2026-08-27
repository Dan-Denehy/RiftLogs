import type { DisplayAction, DisplayTurn } from "./atlasCapture";

export type UnitLocation = "base" | string;

export type DerivedUnit = {
  id: string;
  name: string;
  location: UnitLocation;
  equipment: string[];
};

export type DerivedHiddenCard = {
  id: string;
  location: string;
  name: string | null;
  placedAtSequence: number;
};

export type MatchStateCorrections = {
  hiddenCardReveals?: Record<number, string>;
};

export type HiddenCardRevealCandidate = {
  actionSequence: number;
  actorPlayerName: string;
  cardName: string;
  hiddenCards: DerivedHiddenCard[];
};

export type DerivedPlayerState = {
  playerId: string | null;
  playerName: string;
  points: number;
  totalRunes: number;
  readyRunes: number;
  turnsStarted: number;
  units: DerivedUnit[];
  hiddenCards: DerivedHiddenCard[];
  unclassifiedBaseCards: string[];
};

export type MatchStateSnapshot = {
  actionSequence: number;
  players: DerivedPlayerState[];
  warnings: string[];
  runeCheckpoint: RuneCheckpoint | null;
};

export type RuneCheckpoint = {
  phase: "start" | "end";
  playerName: string;
  totalRunes: number;
  readyRunes: number;
};

type MutableState = {
  players: Map<string, DerivedPlayerState>;
  warnings: string[];
  nextUnitId: number;
  nextHiddenCardId: number;
};

export function reconstructMatchState(
  turns: DisplayTurn[],
  corrections: MatchStateCorrections = {},
) {
  const actions = turns
    .flatMap((turn) => turn.actions)
    .sort((left, right) => left.sequence - right.sequence);
  const confirmedUnitNames = findConfirmedUnitNames(actions);
  const initial = initialState(turns);
  const activeHistory: MutableState[] = [initial];
  const snapshots = new Map<number, MatchStateSnapshot>();
  let previousTurnKey: string | null = null;
  let previousTimelineAction: DisplayAction | null = null;

  for (const action of actions) {
    const turnKey = actionTurnKey(action);
    const startsNewTurn = turnKey !== null && turnKey !== previousTurnKey;
    if (turnKey !== null) previousTurnKey = turnKey;
    let runeCheckpoint: RuneCheckpoint | null = null;

    if (
      action.actionType === "score-observation" ||
      action.actionType === "trash-observation"
    ) {
      const corrected = cloneState(activeHistory.at(-1) ?? initial);
      if (startsNewTurn) {
        applyTurnStart(corrected, action);
        runeCheckpoint = runeCheckpointFor(corrected, action, "start");
      }
      if (action.actionType === "score-observation") {
        applyObservedScores(corrected, action);
      } else {
        applyObservedTrashMovement(corrected, action, previousTimelineAction);
      }
      activeHistory[activeHistory.length - 1] = corrected;
    } else if (action.actionType === "rewind" || /\brewound\b/i.test(action.text)) {
      if (activeHistory.length > 1) activeHistory.pop();
    } else {
      const next = cloneState(activeHistory.at(-1) ?? initial);
      if (startsNewTurn) {
        applyTurnStart(next, action);
        runeCheckpoint = runeCheckpointFor(next, action, "start");
      }
      applyAction(next, action, confirmedUnitNames, corrections);
      if (/^Ended\s+their\s+turn\.$/i.test(action.text)) {
        runeCheckpoint = runeCheckpointFor(next, action, "end");
      }
      activeHistory.push(next);
    }

    snapshots.set(
      action.sequence,
      snapshotOf(action.sequence, activeHistory.at(-1)!, runeCheckpoint),
    );
    previousTimelineAction = action;
  }

  return snapshots;
}

function applyObservedTrashMovement(
  state: MutableState,
  observation: DisplayAction,
  precedingAction: DisplayAction | null,
) {
  const movedToTrash = precedingAction?.text.match(
    /^Moved\s+1\s+card\s+from\s+(.+?)\s+to\s+trash\.$/i,
  );
  if (!precedingAction || !movedToTrash) return;
  const source = movedToTrash[1];
  const actor = playerForAction(state, precedingAction);

  for (const observedCard of observation.observedTrashCards) {
    const allMatches = [...state.players.values()].flatMap((player) =>
      player.units
        .filter(
          (unit) =>
            unit.name.toLowerCase() === observedCard.name.toLowerCase() &&
            unit.location.toLowerCase() === source.toLowerCase(),
        )
        .map((unit) => ({ player, unit })),
    );
    const actorMatches = actor
      ? allMatches.filter((match) => match.player === actor)
      : [];
    const matches = actorMatches.length === 1 ? actorMatches : allMatches;

    const interchangeableMatches =
      matches.length > 1 &&
      matches.every(
        (match) =>
          match.player === matches[0].player &&
          JSON.stringify(match.unit.equipment) ===
            JSON.stringify(matches[0].unit.equipment),
      );
    if (matches.length === 1 || interchangeableMatches) {
      removeUnit(matches[0].player, matches[0].unit);
      clearAmbiguousTrashWarning(state, precedingAction.sequence);
      continue;
    }

    if (source.toLowerCase() === "base") {
      const unclassifiedMatches = (actor ? [actor] : [...state.players.values()])
        .flatMap((player) =>
          player.unclassifiedBaseCards.flatMap((name, index) =>
            name.toLowerCase() === observedCard.name.toLowerCase()
              ? [{ player, index }]
              : [],
          ),
        );
      if (unclassifiedMatches.length > 0) {
        const match = unclassifiedMatches[0];
        match.player.unclassifiedBaseCards.splice(match.index, 1);
        clearAmbiguousTrashWarning(state, precedingAction.sequence);
        continue;
      }
    }

    const hiddenMatches = (actor ? [actor] : [...state.players.values()]).flatMap(
      (player) =>
        player.hiddenCards
          .filter((card) => card.location.toLowerCase() === source.toLowerCase())
          .map((card) => ({ player, card })),
    );
    if (hiddenMatches.length === 1) {
      hiddenMatches[0].player.hiddenCards = hiddenMatches[0].player.hiddenCards.filter(
        (card) => card.id !== hiddenMatches[0].card.id,
      );
      clearAmbiguousTrashWarning(state, precedingAction.sequence);
    }
  }
}

function removeUnit(player: DerivedPlayerState, unit: DerivedUnit) {
  player.unclassifiedBaseCards.push(...unit.equipment);
  player.units = player.units.filter((candidate) => candidate.id !== unit.id);
}

function clearAmbiguousTrashWarning(state: MutableState, sequence: number) {
  const prefix = `Action #${sequence} trashed an unnamed card`;
  state.warnings = state.warnings.filter((warning) => !warning.startsWith(prefix));
}

export function findHiddenCardRevealCandidates(
  turns: DisplayTurn[],
  snapshots: Map<number, MatchStateSnapshot>,
) {
  const pendingPlays = new Map<string, number>();
  const candidates: HiddenCardRevealCandidate[] = [];
  const actions = turns
    .flatMap((turn) => turn.actions)
    .sort((left, right) => left.sequence - right.sequence);

  for (const action of actions) {
    const actor = action.actorPlayerName;
    if (!actor) continue;
    const played = action.text.match(/^Played\s+(.+?)(?:\s+from\b|\s+token\b|\.$)/i);
    if (played) {
      const key = `${actor}:${played[1].toLowerCase()}`;
      pendingPlays.set(key, (pendingPlays.get(key) ?? 0) + 1);
    }

    const resolved = action.text.match(/^Chain\s+resolved:\s+(.+)\.$/i);
    if (!resolved) continue;
    const key = `${actor}:${resolved[1].toLowerCase()}`;
    const playCount = pendingPlays.get(key) ?? 0;
    if (playCount > 0) {
      pendingPlays.set(key, playCount - 1);
      continue;
    }

    const player = snapshots
      .get(action.sequence)
      ?.players.find((candidate) => candidate.playerName === actor);
    if (player?.hiddenCards.length) {
      candidates.push({
        actionSequence: action.sequence,
        actorPlayerName: actor,
        cardName: resolved[1],
        hiddenCards: player.hiddenCards.map((card) => ({ ...card })),
      });
    }
  }

  return candidates;
}

function actionTurnKey(action: DisplayAction) {
  if (action.turnNumber === null) return null;
  return `${action.turnNumber}:${action.turnPlayerId ?? action.turnPlayerName ?? "unknown"}`;
}

function applyTurnStart(state: MutableState, action: DisplayAction) {
  const player = playerForTurn(state, action);
  if (!player) return;

  const heldBattlefields = new Set(
    player.units
      .map((unit) => unit.location.trim().toLowerCase())
      .filter((location) => location !== "base"),
  );
  player.points = Math.min(8, player.points + heldBattlefields.size);

  if (player.turnsStarted === 0) {
    player.totalRunes = action.turnNumber === 1 ? 2 : 3;
  } else {
    player.totalRunes = Math.min(12, player.totalRunes + 2);
  }
  player.readyRunes = player.totalRunes;
  player.turnsStarted += 1;
}

function runeCheckpointFor(
  state: MutableState,
  action: DisplayAction,
  phase: RuneCheckpoint["phase"],
) {
  const player = playerForTurn(state, action);
  return player
    ? {
        phase,
        playerName: player.playerName,
        totalRunes: player.totalRunes,
        readyRunes: player.readyRunes,
      }
    : null;
}

function initialState(turns: DisplayTurn[]): MutableState {
  const players = new Map<string, DerivedPlayerState>();
  for (const turn of turns) {
    addPlayer(players, turn.turnPlayerId, turn.turnPlayerName);
    for (const action of turn.actions) {
      addPlayer(players, action.actorPlayerId, action.actorPlayerName);
    }
  }
  return { players, warnings: [], nextUnitId: 1, nextHiddenCardId: 1 };
}

function addPlayer(
  players: Map<string, DerivedPlayerState>,
  playerId: string | null,
  playerName: string | null,
) {
  if (!playerName) return;
  const key = playerKey(playerId, playerName);
  if (!players.has(key)) {
    players.set(key, {
      playerId,
      playerName,
      points: 0,
      totalRunes: 0,
      readyRunes: 0,
      turnsStarted: 0,
      units: [],
      hiddenCards: [],
      unclassifiedBaseCards: [],
    });
  }
}

function applyAction(
  state: MutableState,
  action: DisplayAction,
  confirmedUnitNames: Set<string>,
  corrections: MatchStateCorrections,
) {
  applyObservedScores(state, action);

  const player = playerForAction(state, action);
  if (!player) return;

  const scored = action.text.match(/\bscored\s+(\d+)\b/i);
  if (scored) player.points += Number(scored[1]);
  const setScore = action.text.match(/^Set\s+score\s+to\s+(\d+)\b/i);
  if (setScore) player.points = Number(setScore[1]);

  const exhaustedRunes =
    action.text.match(/^Exhausted\s+(\d+)\s+.*?runes?\.$/i)?.[1] ??
    action.text.match(/[—·]\s*Exhaust\s+(\d+)\b/i)?.[1];
  if (exhaustedRunes) {
    player.readyRunes = Math.max(0, player.readyRunes - Number(exhaustedRunes));
  }

  const recycledRunes = action.text.match(
    /\bRecycle(?:d)?\s+(\d+)\s+.*?runes?\b/i,
  )?.[1];
  if (recycledRunes) {
    const amount = Number(recycledRunes);
    player.totalRunes = Math.max(0, player.totalRunes - amount);
    player.readyRunes = Math.min(player.totalRunes, player.readyRunes);
  }

  const channeledRunes = action.text.match(/\bChanneled\s+(\d+)\s+runes?\b/i)?.[1];
  if (channeledRunes) {
    const amount = Number(channeledRunes);
    player.totalRunes = Math.min(12, player.totalRunes + amount);
    player.readyRunes = Math.min(12, player.readyRunes + amount);
  }

  const readiedRunes = action.text.match(/\bReadied\s+(\d+)\s+.*?runes?\b/i)?.[1];
  if (readiedRunes) {
    player.readyRunes = Math.min(
      player.totalRunes,
      player.readyRunes + Number(readiedRunes),
    );
  }

  const playedCard = action.text.match(
    /^Played\s+(.+?)\s+from\s+.+?\s+to\s+(.+)\.$/i,
  );
  const playedToken = action.text.match(/^Played\s+(.+?)\s+token\s+to\s+base\.$/i);
  const playedName = playedCard?.[1] ?? playedToken?.[1] ?? null;
  const playedDestination = playedCard?.[2] ?? "base";
  if (playedName) {
    if (
      playedDestination.toLowerCase() !== "base" ||
      confirmedUnitNames.has(playedName)
    ) {
      addUnit(state, player, playedName, playedDestination);
    } else {
      player.unclassifiedBaseCards.push(playedName);
    }
  }

  const hiddenCard = action.text.match(/^Put\s+a\s+hidden\s+card\s+to\s+(.+)\.$/i);
  if (hiddenCard) {
    player.hiddenCards.push({
      id: `hidden-${state.nextHiddenCardId++}`,
      location: hiddenCard[1],
      name: null,
      placedAtSequence: action.sequence,
    });
  }

  const resolved = action.text.match(/^Chain\s+resolved:\s+(.+)\.$/i);
  const revealedHiddenCardId = corrections.hiddenCardReveals?.[action.sequence];
  if (resolved && revealedHiddenCardId) {
    const card = player.hiddenCards.find(
      (candidate) => candidate.id === revealedHiddenCardId,
    );
    if (card) card.name = resolved[1];
  }

  const moved = action.text.match(/^Moved\s+(.+?)\s+to\s+(.+)\.$/i);
  if (moved && isNamedCardMove(moved[1])) {
    moveUnit(state, player, moved[1], moved[2]);
  }

  const equipped = action.text.match(/^Equipped\s+(.+?)\s+to\s+(.+)\.$/i);
  if (equipped) {
    attachEquipment(state, player, equipped[1], equipped[2]);
  }

  if (
    /^Used\s+a\s+Gold\s+token\.$/i.test(action.text) ||
    /[—·]\s*Gold\.$/i.test(action.text)
  ) {
    removeUnclassifiedBaseCard(player, "Gold");
  }

  const trashed = action.text.match(
    /^Moved\s+1\s+card\s+from\s+(.+?)\s+to\s+trash\.$/i,
  );
  if (trashed) removeOnlyKnownUnitAt(state, player, trashed[1], action.sequence);
}

function applyObservedScores(state: MutableState, action: DisplayAction) {
  for (const observation of action.observedScores) {
    const players = [...state.players.values()];
    const label = observation.label.toLowerCase();
    let player = observation.playerName
      ? players.find((candidate) => candidate.playerName === observation.playerName)
      : undefined;
    player ??= players.find((candidate) =>
      label.includes(candidate.playerName.toLowerCase()),
    );

    // RiftAtlas labels the two tracks from the signed-in spectator account's
    // perspective. In our captures it also names the remote seat "Opponent".
    if (!player && observation.perspective === "opponent") {
      player = players.find((candidate) => /^opponent$/i.test(candidate.playerName));
    }
    if (!player && observation.perspective === "your") {
      const nonOpponent = players.filter(
        (candidate) => !/^opponent$/i.test(candidate.playerName),
      );
      if (nonOpponent.length === 1) player = nonOpponent[0];
    }

    if (player) {
      // RiftAtlas resets the visible score control to zero after a completed
      // game. A match capture represents one game, so do not erase a winning 8.
      if (!(player.points >= 8 && observation.score === 0)) {
        player.points = observation.score;
      }
    } else {
      state.warnings.push(
        `Could not associate score track "${observation.label}" with a player at event ${action.sequence}.`,
      );
    }
  }
}

function findConfirmedUnitNames(actions: DisplayAction[]) {
  const names = new Set<string>();
  for (const action of actions) {
    const moved = action.text.match(/^Moved\s+(.+?)\s+to\s+(.+)\.$/i);
    if (moved && isNamedCardMove(moved[1])) names.add(moved[1]);
    const equipped = action.text.match(/^Equipped\s+.+?\s+to\s+(.+)\.$/i);
    if (equipped) names.add(equipped[1]);
  }
  return names;
}

function addUnit(
  state: MutableState,
  player: DerivedPlayerState,
  name: string,
  location: UnitLocation,
) {
  player.units.push({
    id: `unit-${state.nextUnitId++}`,
    name,
    location,
    equipment: [],
  });
}

function moveUnit(
  state: MutableState,
  player: DerivedPlayerState,
  name: string,
  destination: string,
) {
  const destinationIsBase = destination.toLowerCase() === "base";
  const matchingUnits = [...player.units]
    .reverse()
    .filter((candidate) => candidate.name === name);
  let unit = destinationIsBase
    ? matchingUnits.find((candidate) => candidate.location !== "base")
    : matchingUnits.find((candidate) => candidate.location === "base");
  unit ??= matchingUnits[0];
  if (!unit) {
    const unresolvedIndex = player.unclassifiedBaseCards.lastIndexOf(name);
    if (unresolvedIndex >= 0) player.unclassifiedBaseCards.splice(unresolvedIndex, 1);
    addUnit(state, player, name, destination);
    unit = player.units.at(-1);
  }
  if (unit) unit.location = destinationIsBase ? "base" : destination;
}

function confirmUnitAtBase(
  state: MutableState,
  player: DerivedPlayerState,
  name: string,
) {
  const existing = [...player.units]
    .reverse()
    .find((unit) => unit.name === name && unit.location === "base");
  if (existing) return existing;
  const unresolvedIndex = player.unclassifiedBaseCards.lastIndexOf(name);
  if (unresolvedIndex >= 0) player.unclassifiedBaseCards.splice(unresolvedIndex, 1);
  addUnit(state, player, name, "base");
  return player.units.at(-1);
}

function attachEquipment(
  state: MutableState,
  player: DerivedPlayerState,
  equipmentName: string,
  unitName: string,
) {
  const target = confirmUnitAtBase(state, player, unitName);
  if (!target) return;

  const looseIndex = player.unclassifiedBaseCards.lastIndexOf(equipmentName);
  if (looseIndex >= 0) {
    player.unclassifiedBaseCards.splice(looseIndex, 1);
  } else {
    const previousUnit = player.units.find(
      (unit) =>
        unit.id !== target.id && unit.equipment.includes(equipmentName),
    );
    const attachedIndex = previousUnit?.equipment.lastIndexOf(equipmentName) ?? -1;
    if (previousUnit && attachedIndex >= 0) {
      previousUnit.equipment.splice(attachedIndex, 1);
    }
  }

  target.equipment.push(equipmentName);
}

function removeUnclassifiedBaseCard(
  player: DerivedPlayerState,
  name: string,
) {
  const index = player.unclassifiedBaseCards.lastIndexOf(name);
  if (index >= 0) player.unclassifiedBaseCards.splice(index, 1);
}

function isNamedCardMove(value: string) {
  return !/^(?:\d+|a)\s+cards?\s+from\b/i.test(value);
}

function removeOnlyKnownUnitAt(
  state: MutableState,
  player: DerivedPlayerState,
  source: string,
  sequence: number,
) {
  const candidates = player.units.filter(
    (unit) => unit.location.toLowerCase() === source.toLowerCase(),
  );
  if (candidates.length === 1) {
    removeUnit(player, candidates[0]);
  } else if (candidates.length === 0) {
    const hiddenIndex = player.hiddenCards.findIndex(
      (card) => card.location.toLowerCase() === source.toLowerCase(),
    );
    if (hiddenIndex >= 0) player.hiddenCards.splice(hiddenIndex, 1);
  } else if (candidates.length > 1) {
    state.warnings.push(
      `Action #${sequence} trashed an unnamed card from ${source}; its unit identity is ambiguous.`,
    );
  }
}

function playerForAction(state: MutableState, action: DisplayAction) {
  if (!action.actorPlayerName) return null;
  return state.players.get(playerKey(action.actorPlayerId, action.actorPlayerName)) ?? null;
}

function playerForTurn(state: MutableState, action: DisplayAction) {
  if (!action.turnPlayerName) return null;
  return state.players.get(
    playerKey(action.turnPlayerId, action.turnPlayerName),
  ) ?? null;
}

function playerKey(playerId: string | null, playerName: string) {
  return playerId ?? `name:${playerName}`;
}

function cloneState(state: MutableState): MutableState {
  return {
    nextUnitId: state.nextUnitId,
    nextHiddenCardId: state.nextHiddenCardId,
    warnings: [...state.warnings],
    players: new Map(
      [...state.players].map(([key, player]) => [
        key,
        {
          ...player,
          units: player.units.map((unit) => ({
            ...unit,
            equipment: [...unit.equipment],
          })),
          hiddenCards: player.hiddenCards.map((card) => ({ ...card })),
          unclassifiedBaseCards: [...player.unclassifiedBaseCards],
        },
      ]),
    ),
  };
}

function snapshotOf(
  actionSequence: number,
  state: MutableState,
  runeCheckpoint: RuneCheckpoint | null,
): MatchStateSnapshot {
  return {
    actionSequence,
    players: [...state.players.values()].map((player) => ({
      ...player,
      units: player.units.map((unit) => ({
        ...unit,
        equipment: [...unit.equipment],
      })),
      hiddenCards: player.hiddenCards.map((card) => ({ ...card })),
      unclassifiedBaseCards: [...player.unclassifiedBaseCards],
    })),
    warnings: [...state.warnings],
    runeCheckpoint,
  };
}
