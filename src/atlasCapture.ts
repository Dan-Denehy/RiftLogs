export type CapturedCard = {
  name?: string | null;
  art?: string | null;
  ariaLabel?: string | null;
};

export type CapturedMarker = {
  marker?: string | null;
};

export type PlayerTone = "green" | "yellow" | "unknown";
export type ActorResolution = "color-marker" | "unknown";

export type DisplayAction = {
  sequence: number;
  turnSequence: number;
  turnNumber: number | null;
  turnPlayerName: string | null;
  turnPlayerId: string | null;
  actorPlayerName: string | null;
  actorPlayerId: string | null;
  actorMarkerColor: string | null;
  actorColorKey: string | null;
  actorResolution: ActorResolution;
  actionType: string | null;
  text: string;
  rawHtml: string;
  captureSequence: number;
  capturedAt: string;
  rawText: string;
  visibleText: string;
  attributes: Record<string, string>;
  actionLabel?: string | null;
  timestamp?: string | null;
  cards: CapturedCard[];
  battlefieldMarkers: CapturedMarker[];
};

export type DisplayTurn = {
  sequence: number;
  turnNumber: number | null;
  turnPlayerId: string | null;
  turnPlayerName: string | null;
  turnColorKey: string | null;
  playerTone: PlayerTone;
  ariaLabel: string | null;
  actions: DisplayAction[];
};

type CapturedActionInput = Partial<DisplayAction> & {
  outerHTML?: string;
  actionKind?: string | null;
};

type RiftLogsCapture = {
  format: "riftlogs-atlas-dom-capture";
  formatVersion: 1;
  order?: "chronological" | "newest-first";
  capturedAt?: string;
  turns: Array<{
    sequence?: number;
    turnNumber?: string | number | null;
    turnPlayerId?: string | null;
    turnPlayerName?: string | null;
    turnColorKey?: string | null;
    playerId?: string | null;
    playerName?: string | null;
    playerTone?: PlayerTone;
    ariaLabel?: string | null;
    actions: CapturedActionInput[];
  }>;
};

type OriginalDomCapture = {
  source: "riftatlas-dom";
  capturedAt?: string;
  url?: string;
  turns: Array<{
    sequence?: number;
    turnNumber?: string | number | null;
    ariaLabel?: string | null;
    html: string;
  }>;
};

type PlayerIdentity = {
  playerId: string | null;
  playerName: string;
};

type TurnContext = {
  sourceSequence: number;
  sourceTurnNumber: string | number | null | undefined;
  sourceAriaLabel: string | null | undefined;
  turnElement: HTMLElement | null;
};

export type AtlasCapture = RiftLogsCapture | OriginalDomCapture;

export type LiveAtlasEventRow = {
  captureSequence: number;
  rawJson: string;
};

export function parseAtlasCapture(rawJson: string) {
  const parsed: unknown = JSON.parse(rawJson);
  if (!isAtlasCapture(parsed)) {
    throw new Error("The file is not a supported RiftAtlas DOM capture.");
  }

  return {
    capture: parsed,
    turns: toDisplayTurns(parsed),
  };
}

export function parseLiveAtlasEvents(rows: LiveAtlasEventRow[]) {
  const parsedRows = rows.map((row) => ({
    captureSequence: row.captureSequence,
    event: parseLiveEvent(row.rawJson),
  }));
  const colorsByPlayer = new Map<string, PlayerIdentity>();

  for (const { event } of parsedRows) {
    const turn = recordOrEmpty(event.turn);
    const playerName = stringOrNull(turn.turnPlayerName);
    if (!playerName) continue;

    const player = {
      playerId: stringOrNull(turn.turnPlayerId),
      playerName,
    };
    for (const key of liveTurnColorKeys(turn)) colorsByPlayer.set(key, player);
  }

  const groupedTurns = new Map<string, DisplayTurn>();
  for (const { captureSequence, event } of parsedRows) {
    const turn = recordOrEmpty(event.turn);
    const action = recordOrEmpty(event.action);
    const turnNumber = numberOrNull(turn.turnNumber);
    const group = recordOrEmpty(event.group);
    const turnPlayerId = stringOrNull(turn.turnPlayerId);
    const turnPlayerName = stringOrNull(turn.turnPlayerName);
    const turnColorKey = liveTurnColorKeys(turn)[0] ?? null;
    const turnKey =
      turnNumber === null && group.kind !== "turn"
        ? "setup"
        : `${turnNumber ?? "unknown"}:${
            turnPlayerId ?? turnPlayerName ?? "unknown"
          }`;
    let displayTurn = groupedTurns.get(turnKey);

    if (!displayTurn) {
      displayTurn = {
        sequence: groupedTurns.size,
        turnNumber,
        turnPlayerId,
        turnPlayerName,
        turnColorKey,
        playerTone: toneFromColorKey(turnColorKey),
        ariaLabel: stringOrNull(turn.ariaLabel),
        actions: [],
      };
      groupedTurns.set(turnKey, displayTurn);
    }

    const actorMarker = recordOrEmpty(action.actorMarker);
    const actorMarkerColor = stringOrNull(actorMarker.backgroundColor);
    const actorColorKey = normalizeRgbKey(actorMarkerColor);
    const actor = actorColorKey ? colorsByPlayer.get(actorColorKey) : undefined;
    const rawHtml = stringOrEmpty(action.outerHTML);
    const parsedAction = new DOMParser().parseFromString(rawHtml, "text/html");
    const actionElement = parsedAction.body.firstElementChild as HTMLElement | null;

    displayTurn.actions.push({
      sequence: captureSequence,
      turnSequence: displayTurn.actions.length,
      turnNumber,
      turnPlayerName,
      turnPlayerId,
      actorPlayerName: actor?.playerName ?? null,
      actorPlayerId: actor?.playerId ?? null,
      actorMarkerColor,
      actorColorKey,
      actorResolution: actor ? "color-marker" : "unknown",
      actionType: stringOrNull(action.actionType),
      text: stringOrEmpty(action.text),
      rawHtml,
      captureSequence,
      capturedAt: stringOrEmpty(event.capturedAt),
      rawText: stringOrEmpty(action.rawText),
      visibleText: stringOrEmpty(action.visibleText),
      attributes: stringRecord(action.attributes),
      actionLabel: stringOrNull(action.actionLabel),
      timestamp: stringOrNull(action.timestamp),
      cards: actionElement ? cardsOf(actionElement) : [],
      battlefieldMarkers: actionElement
        ? battlefieldMarkersOf(actionElement)
        : [],
    });
  }

  return [...groupedTurns.values()].sort((left, right) => {
    if (left.turnNumber !== null && right.turnNumber !== null) {
      return left.turnNumber - right.turnNumber;
    }
    return left.sequence - right.sequence;
  });
}

export function analyzeCaptureCompleteness(turns: DisplayTurn[]) {
  const actions = turns.flatMap((turn) => turn.actions);
  const setupAction = actions.find((action) =>
    isInitiatingPhaseText(`${action.actionLabel ?? ""} ${action.text}`),
  );

  return {
    initiatingPhaseCaptured: Boolean(setupAction),
    initiatingActionSequence: setupAction?.sequence ?? null,
  };
}

export function isAtlasCapture(value: unknown): value is AtlasCapture {
  if (!isRecord(value)) return false;

  if (
    value.format === "riftlogs-atlas-dom-capture" &&
    value.formatVersion === 1 &&
    Array.isArray(value.turns)
  ) {
    return value.turns.every(
      (turn) => isRecord(turn) && Array.isArray(turn.actions),
    );
  }

  return (
    value.source === "riftatlas-dom" &&
    Array.isArray(value.turns) &&
    value.turns.every(
      (turn) => isRecord(turn) && typeof turn.html === "string",
    )
  );
}

export function normalizeRgbKey(color: string | null | undefined) {
  if (!color || color === "transparent") return null;
  const functionMatch = color.match(/rgba?\(([^)]*)\)/i);
  if (!functionMatch) return null;

  const components = functionMatch[1].match(/\d*\.?\d+%?/g);
  if (!components || components.length < 3) return null;

  const alpha = components[3];
  if (alpha && numericColorComponent(alpha, true) === 0) return null;

  return components
    .slice(0, 3)
    .map((component) => numericColorComponent(component, false))
    .join(",");
}

function toDisplayTurns(capture: AtlasCapture): DisplayTurn[] {
  if ("format" in capture) {
    return parseRiftLogsCapture(capture);
  }
  return parseOriginalDomCapture(capture);
}

function parseRiftLogsCapture(capture: RiftLogsCapture) {
  let fallbackCaptureSequence = 1;
  const capturedAt = capture.capturedAt ?? "";
  const turns: DisplayTurn[] = capture.turns.map((turn, turnIndex) => {
    const turnNumber = numberOrNull(turn.turnNumber);
    const turnPlayerName =
      turn.turnPlayerName ?? turn.playerName ?? playerNameFrom(turn.ariaLabel);
    const turnPlayerId = turn.turnPlayerId ?? turn.playerId ?? null;
    const turnColorKey = turn.turnColorKey ?? null;

    return {
      sequence: turn.sequence ?? turnIndex,
      turnNumber,
      turnPlayerId,
      turnPlayerName,
      turnColorKey,
      playerTone: turn.playerTone ?? toneFromColorKey(turnColorKey),
      ariaLabel: turn.ariaLabel ?? null,
      actions: turn.actions.map((action, actionIndex) => {
        const actorWasResolved =
          action.actorResolution === "color-marker" &&
          Boolean(action.actorPlayerName);
        const rawText = action.rawText ?? action.visibleText ?? action.text ?? "";
        const timestamp = action.timestamp ?? timestampFrom(rawText);
        const captureSequence =
          action.captureSequence ?? fallbackCaptureSequence++;

        return {
          sequence: action.sequence ?? captureSequence,
          turnSequence: action.turnSequence ?? actionIndex,
          turnNumber: numberOrNull(action.turnNumber) ?? turnNumber,
          turnPlayerName: action.turnPlayerName ?? turnPlayerName,
          turnPlayerId: action.turnPlayerId ?? turnPlayerId,
          actorPlayerName: actorWasResolved ? action.actorPlayerName ?? null : null,
          actorPlayerId: actorWasResolved ? action.actorPlayerId ?? null : null,
          actorMarkerColor: action.actorMarkerColor ?? null,
          actorColorKey: action.actorColorKey ?? null,
          actorResolution: actorWasResolved ? "color-marker" : "unknown",
          actionType: action.actionType ?? action.actionKind ?? null,
          text: action.text ?? withoutTimestamp(rawText, timestamp),
          rawHtml: action.rawHtml ?? action.outerHTML ?? "",
          captureSequence,
          capturedAt: action.capturedAt ?? capturedAt,
          rawText,
          visibleText: action.visibleText ?? rawText,
          attributes: action.attributes ?? {},
          actionLabel: action.actionLabel,
          timestamp,
          cards: action.cards ?? [],
          battlefieldMarkers: action.battlefieldMarkers ?? [],
        };
      }),
    };
  });

  return orderForDisplay(turns, capture.order !== "chronological");
}

function parseOriginalDomCapture(capture: OriginalDomCapture) {
  const contexts: TurnContext[] = capture.turns.map((turn, turnIndex) => {
    const parsedDocument = new DOMParser().parseFromString(turn.html, "text/html");
    return {
      sourceSequence: turn.sequence ?? turnIndex,
      sourceTurnNumber: turn.turnNumber,
      sourceAriaLabel: turn.ariaLabel,
      turnElement: parsedDocument.querySelector<HTMLElement>(
        '[data-match-log-group="turn"]',
      ),
    };
  });
  const playerByColor = buildPlayerColorMap(
    contexts.flatMap(({ turnElement }) => (turnElement ? [turnElement] : [])),
  );

  let captureSequence = 1;
  const turns: DisplayTurn[] = contexts.map((context) => {
    const { turnElement } = context;
    const sourceTurnNumber = numberOrNull(context.sourceTurnNumber);
    if (!turnElement) {
      return {
        sequence: context.sourceSequence,
        turnNumber: sourceTurnNumber,
        turnPlayerId: null,
        turnPlayerName: null,
        turnColorKey: null,
        playerTone: "unknown",
        ariaLabel: context.sourceAriaLabel ?? null,
        actions: [],
      };
    }

    const turnInfo = turnIdentityFrom(
      turnElement,
      sourceTurnNumber,
      context.sourceAriaLabel,
    );
    const actionRows = uniqueActionRows(turnElement);

    return {
      sequence: context.sourceSequence,
      turnNumber: turnInfo.turnNumber,
      turnPlayerId: turnInfo.playerId,
      turnPlayerName: turnInfo.playerName,
      turnColorKey: turnInfo.primaryColorKey,
      playerTone: toneFromColorKey(turnInfo.primaryColorKey),
      ariaLabel: turnInfo.ariaLabel,
      actions: actionRows.map((row, actionIndex) => {
        const actionTypeMarker = row.querySelector<HTMLElement>(
          "[data-log-action-kind]",
        );
        const actorMarker = findActorMarker(row);
        const actorMarkerColor = actorMarkerColorFrom(actorMarker);
        const actorColorKey = normalizeRgbKey(actorMarkerColor);
        const actor = actorColorKey ? playerByColor.get(actorColorKey) : undefined;
        const timestamp = timestampFromElement(row);
        const rawText = row.textContent ?? "";

        return {
          sequence: captureSequence,
          turnSequence: actionIndex,
          turnNumber: turnInfo.turnNumber,
          turnPlayerName: turnInfo.playerName,
          turnPlayerId: turnInfo.playerId,
          actorPlayerName: actor?.playerName ?? null,
          actorPlayerId: actor?.playerId ?? null,
          actorMarkerColor,
          actorColorKey,
          actorResolution: actor ? "color-marker" : "unknown",
          actionType:
            actionTypeMarker?.getAttribute("data-log-action-kind") ?? null,
          text: withoutTimestamp(rawText, timestamp),
          rawHtml: row.outerHTML,
          captureSequence: captureSequence++,
          capturedAt: capture.capturedAt ?? "",
          rawText,
          visibleText: rawText,
          attributes: attributesOf(row),
          actionLabel:
            actionTypeMarker?.getAttribute("data-log-action-label") ?? null,
          timestamp,
          cards: cardsOf(row),
          battlefieldMarkers: battlefieldMarkersOf(row),
        };
      }),
    };
  });

  return orderForDisplay(turns, true);
}

function buildPlayerColorMap(turnElements: HTMLElement[]) {
  const resolved = new Map<string, PlayerIdentity>();
  const ambiguous = new Set<string>();

  for (const turnElement of turnElements) {
    const identity = turnIdentityFrom(turnElement, null, null);
    if (!identity.playerName) continue;

    for (const colorKey of identity.paletteColorKeys) {
      if (ambiguous.has(colorKey)) continue;
      const existing = resolved.get(colorKey);
      const player = {
        playerId: identity.playerId,
        playerName: identity.playerName,
      };

      if (existing && !samePlayer(existing, player)) {
        resolved.delete(colorKey);
        ambiguous.add(colorKey);
      } else {
        resolved.set(colorKey, player);
      }
    }
  }

  return resolved;
}

function turnIdentityFrom(
  turnElement: HTMLElement,
  sourceTurnNumber: number | null,
  sourceAriaLabel: string | null | undefined,
) {
  const divider = turnElement.querySelector<HTMLElement>(
    '[data-match-log-turn-divider="true"]',
  );
  const dividerHeader = divider?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  const dividerMatch = dividerHeader.match(
    /turn\s+(\d+)\s*[·•]\s*(.+)$/i,
  );
  const ariaLabel =
    sourceAriaLabel ||
    turnElement.getAttribute("aria-label") ||
    turnElement.querySelector("section[aria-label]")?.getAttribute("aria-label") ||
    null;
  const ariaMatch = ariaLabel?.match(/^turn\s+(\d+)\s*,\s*(.+)$/i);
  const turnNumber =
    numberOrNull(dividerMatch?.[1]) ??
    sourceTurnNumber ??
    numberOrNull(turnElement.getAttribute("data-turn-number")) ??
    numberOrNull(ariaMatch?.[1]);
  const playerName = dividerMatch?.[2]?.trim() ?? ariaMatch?.[2]?.trim() ?? null;
  const paletteColorKeys = divider ? paletteColorKeysFrom(divider) : [];

  return {
    turnNumber,
    playerId: turnElement.getAttribute("data-turn-player-id"),
    playerName,
    ariaLabel,
    paletteColorKeys,
    primaryColorKey: primaryPaletteColorKey(paletteColorKeys),
  };
}

function paletteColorKeysFrom(divider: HTMLElement) {
  const keys = new Set<string>();
  const elements = [divider, ...divider.querySelectorAll<HTMLElement>("*")];

  for (const element of elements) {
    const rawSources = [
      element.getAttribute("class") ?? "",
      element.getAttribute("style") ?? "",
    ];
    const view = element.ownerDocument.defaultView;
    if (view) {
      const computed = view.getComputedStyle(element);
      rawSources.push(
        computed.color,
        computed.backgroundColor,
        computed.backgroundImage,
        computed.boxShadow,
        computed.borderColor,
      );
    }

    for (const source of rawSources) {
      for (const color of rgbFunctionsFrom(source)) {
        const key = normalizeRgbKey(color);
        if (key) keys.add(key);
      }
    }
  }

  return [...keys];
}

function primaryPaletteColorKey(keys: string[]) {
  return keys[0] ?? null;
}

function findActorMarker(actionRow: HTMLElement) {
  const spans = Array.from(actionRow.querySelectorAll<HTMLElement>("span"));
  return (
    spans.find((span) => {
      const className = span.getAttribute("class") ?? "";
      if (
        className.includes("absolute") &&
        className.includes("left-") &&
        (className.includes("w-[0.1rem]") || className.includes("rounded-full"))
      ) {
        return true;
      }

      const view = span.ownerDocument.defaultView;
      if (!view) return false;
      const computed = view.getComputedStyle(span);
      const width = Number.parseFloat(computed.width);
      return (
        computed.position === "absolute" &&
        Number.isFinite(width) &&
        width > 0 &&
        width <= 4
      );
    }) ?? null
  );
}

function actorMarkerColorFrom(marker: HTMLElement | null) {
  if (!marker) return null;
  const view = marker.ownerDocument.defaultView;
  const computedColor = view?.getComputedStyle(marker).backgroundColor ?? "";
  if (normalizeRgbKey(computedColor)) return computedColor;

  const classOrStyle = `${marker.getAttribute("class") ?? ""} ${
    marker.getAttribute("style") ?? ""
  }`;
  const backgroundClass = classOrStyle.match(/bg-\[(rgba?\([^)]*\))\]/i);
  return backgroundClass?.[1] ?? rgbFunctionsFrom(classOrStyle)[0] ?? null;
}

function orderForDisplay(turns: DisplayTurn[], sourceIsNewestFirst: boolean) {
  const orderedTurns = [...turns].sort((left, right) => {
    if (left.turnNumber !== null && right.turnNumber !== null) {
      return left.turnNumber - right.turnNumber;
    }
    return sourceIsNewestFirst
      ? right.sequence - left.sequence
      : left.sequence - right.sequence;
  });

  let chronologicalSequence = 1;
  return orderedTurns.map((turn, turnIndex) => {
    const actions = sourceIsNewestFirst
      ? [...turn.actions].reverse()
      : [...turn.actions];

    return {
      ...turn,
      sequence: turnIndex,
      actions: actions.map((action, actionIndex) => ({
        ...action,
        sequence: chronologicalSequence++,
        turnSequence: actionIndex,
      })),
    };
  });
}

function uniqueActionRows(turnElement: HTMLElement) {
  const rows = Array.from(
    turnElement.querySelectorAll<HTMLElement>("[data-log-action-kind]"),
  )
    .map((marker) => marker.closest<HTMLElement>("li"))
    .filter(
      (row): row is HTMLElement =>
        row !== null && row !== turnElement && turnElement.contains(row),
    );

  return [...new Set(rows)];
}

function cardsOf(action: HTMLElement): CapturedCard[] {
  return Array.from(
    action.querySelectorAll<HTMLElement>("[data-log-card-name]"),
  ).map((nameElement) => {
    const container = nameElement.closest<HTMLElement>("button") ?? nameElement;
    const artElement = container.querySelector<HTMLElement>("[data-log-card-art]");
    const image = artElement?.querySelector<HTMLImageElement>("img");
    const nameAttribute = nameElement.getAttribute("data-log-card-name");
    const artAttribute = artElement?.getAttribute("data-log-card-art");

    return {
      name:
        nameAttribute && nameAttribute !== "true"
          ? nameAttribute
          : nameElement.textContent?.trim() || null,
      art:
        artAttribute && artAttribute !== "true"
          ? artAttribute
          : image?.getAttribute("src") ?? null,
      ariaLabel: container.getAttribute("aria-label"),
    };
  });
}

function battlefieldMarkersOf(action: HTMLElement): CapturedMarker[] {
  return Array.from(
    action.querySelectorAll<HTMLElement>("[data-battlefield-marker]"),
  ).map((element) => {
    const markerAttribute = element.getAttribute("data-battlefield-marker");
    const ariaLabel = element.getAttribute("aria-label");
    return {
      marker:
        markerAttribute && markerAttribute !== "true"
          ? markerAttribute
          : ariaLabel?.replace(/\s+card preview$/i, "") ||
            element.textContent?.trim() ||
            null,
    };
  });
}

function timestampFromElement(action: HTMLElement) {
  const timestamp = Array.from(action.querySelectorAll("span"))
    .map((element) => element.textContent?.trim() ?? "")
    .find((text) => /^\d{1,2}:\d{2}$/.test(text));
  return timestamp ?? timestampFrom(action.textContent ?? "");
}

function timestampFrom(text: string | undefined) {
  return text?.match(/^\s*(\d{1,2}:\d{2})/)?.[1] ?? null;
}

function withoutTimestamp(text: string, timestamp: string | null | undefined) {
  if (!timestamp) return text.trim();
  return text.replace(new RegExp(`^\\s*${escapeRegex(timestamp)}\\s*`), "").trim();
}

function attributesOf(element: Element) {
  return Object.fromEntries(
    Array.from(element.attributes, ({ name, value }) => [name, value]),
  );
}

function playerNameFrom(ariaLabel: string | null | undefined) {
  if (!ariaLabel) return null;
  return ariaLabel.match(/^turn\s+\d+\s*,\s*(.+)$/i)?.[1] ?? null;
}

function toneFromColorKey(colorKey: string | null): PlayerTone {
  if (!colorKey) return "unknown";
  const [red, green, blue] = colorKey.split(",").map(Number);
  if (green > red && green >= blue) return "green";
  if (red > green && green > blue) return "yellow";
  return "unknown";
}

function rgbFunctionsFrom(source: string) {
  return source.match(/rgba?\([^)]*\)/gi) ?? [];
}

function numericColorComponent(value: string, isAlpha: boolean) {
  const numeric = Number.parseFloat(value);
  if (isAlpha) return value.endsWith("%") ? numeric / 100 : numeric;
  const channel = value.endsWith("%") ? (numeric / 100) * 255 : numeric;
  return Math.max(0, Math.min(255, Math.round(channel)));
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function samePlayer(left: PlayerIdentity, right: PlayerIdentity) {
  if (left.playerId && right.playerId) return left.playerId === right.playerId;
  return left.playerName === right.playerName;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseLiveEvent(rawJson: string) {
  const parsed: unknown = JSON.parse(rawJson);
  if (
    !isRecord(parsed) ||
    parsed.format !== "riftlogs-atlas-live-event" ||
    parsed.formatVersion !== 1 ||
    !isRecord(parsed.turn) ||
    !isRecord(parsed.action)
  ) {
    throw new Error("A stored event is not a supported RiftLogs live event.");
  }
  return parsed;
}

function isInitiatingPhaseText(text: string) {
  return (
    /\bmulligan(?:s|ed|ing)?\b/i.test(text) ||
    /\b(?:selected|selects|chose|chooses|picked|picks)\b.{0,50}\bbattlefields?\b/i.test(
      text,
    ) ||
    /\bbattlefields?\b.{0,50}\b(?:selected|selects|chosen|picked)\b/i.test(
      text,
    )
  );
}

function liveTurnColorKeys(turn: Record<string, unknown>) {
  const divider = recordOrEmpty(turn.divider);
  const computedStyle = recordOrEmpty(divider.computedStyle);
  const sources = [
    stringOrEmpty(divider.outerHTML),
    ...Object.values(computedStyle).filter(
      (value): value is string => typeof value === "string",
    ),
  ];
  const keys = new Set<string>();
  for (const source of sources) {
    for (const color of rgbFunctionsFrom(source)) {
      const key = normalizeRgbKey(color);
      if (key) keys.add(key);
    }
  }
  return [...keys];
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

function stringOrEmpty(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stringRecord(value: unknown) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
