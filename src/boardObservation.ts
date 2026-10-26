import type { BoardState, Observation, Section } from "./stateContext.ts";

export type CompactLogEntry = { key: string; text: string; turn: number | null; actorId?: string | null };
export type CompactObservation = Observation & {
  source: "riftatlas-board";
  metadata: { room: string | null; phase: string | null; resetToken: string | null;
    authoritativeSequence: number | null; url: string };
  cardScope: "visible-only";
  logs: CompactLogEntry[];
  reason?: string;
  sourceSequence?: number;
};

// Pure extraction: no timers, network access or database writes.
// Self-contained: the same extractor runs in Playwright and fixture tests.
export function captureBoardState(document: Document, sequence: number, capturedAt: string,
  sections: Section[] = ["context", "scores", "resources", "cards"]): CompactObservation {
  const count = (value: string | null | undefined): number | null =>
    value != null && /^\d+$/.test(value) ? Number(value) : null;
  const bool = (value: string | null): boolean | null => value === "true" ? true : value === "false" ? false : null;
  const root = document.querySelector("[data-viewer-player-id]");
  const state: BoardState = { context: { turn: null, activePlayerId: null }, players: {}, scores: {}, resources: {}, cards: null };
  const validId = (value: string | null | undefined) => value?.startsWith("plr_") ? value : null;
  const owners: Record<string, string> = {};
  if (sections.includes("context")) state.context = {
    turn: count(root?.getAttribute("data-turn-number")),
    activePlayerId: validId(root?.getAttribute("data-active-player-id")),
  };
  for (const side of ["self", "opponent"] as const) {
    const prefix = side === "self" ? "viewer" : "opponent";
    const id = validId(root?.getAttribute(`data-${prefix}-player-id`));
    if (!id) continue;
    owners[side] = id;
    const name = document.querySelector(`[data-player-identity-rail="${side}"] [data-identity-player-name]`)?.textContent?.trim();
    if (name) state.players[id] = name;
    else state.players[id] = id;
    if (sections.includes("scores")) state.scores[id] = count(root?.getAttribute(`data-${prefix}-score`));
    if (sections.includes("resources")) {
      const runes = document.querySelector(`[data-zone-owner="${side}"][data-rune-ready-count], [data-zone-owner="${side}"] [data-rune-ready-count]`);
      const deck = document.querySelector(`[data-pile-owner="${side}"][data-pile-slot="mainDeck"]`);
      state.resources[id] = { ready: count(runes?.getAttribute("data-rune-ready-count")), used: count(runes?.getAttribute("data-rune-used-count")), hand: null, deck: count(deck?.getAttribute("data-pile-count")) };
    }
  }
  if (sections.includes("cards") && root?.querySelector("[data-drop-zone-root]")) {
    const cards = new Map<string, NonNullable<BoardState["cards"]>[number]>();
    for (const element of root.querySelectorAll('[data-board-card-visual="true"], button[data-drop-zone="trash"][data-card-id]')) {
      const id = element.getAttribute("data-card-id");
      const side = element.getAttribute("data-visual-owner") ?? element.closest("[data-zone-owner]")?.getAttribute("data-zone-owner");
      const ownerId = side ? owners[side] : null;
      const zone = element.getAttribute("data-drop-zone");
      if (!id || !ownerId || !zone || cards.has(id)) continue;
      const image = element.querySelector("img[alt]");
      // visual-hidden is an animation flag, not the card's face-down state.
      const hidden = bool(element.getAttribute("data-face-down"));
      const alt = image?.getAttribute("alt")?.trim();
      const concealed = hidden === true || !alt || /card back/i.test(alt);
      const imageUrl = concealed ? null : image?.getAttribute("data-card-art-source") || image?.getAttribute("src") || null;
      const imageFallbackUrl = concealed ? null : image?.getAttribute("src") ?? null;
      cards.set(id, { id, ownerId, zone, name: hidden || !alt || /card back/i.test(alt) ? null : alt,
        hidden, exhausted: bool(element.getAttribute("data-exhausted")), attachedTo: null, cardType: "unknown", imageUrl, imageFallbackUrl });
    }
    state.cards = [...cards.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  const rgbKeys = (value: string) => [...value.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)].map((match) => `${Number(match[1])},${Number(match[2])},${Number(match[3])}`);
  const palette = new Map<string, Set<string>>();
  if (sections.includes("cards")) {
    const panel = document.querySelector("[data-chain-targeting]");
    const entries = Array.from(document.querySelectorAll("[data-chain-timeline-entry-id]"));
    const stack = Array.from(document.querySelectorAll("[data-chain-entry-id]"));
    // Without a timeline, a nonempty stack may be only partially rendered.
    state.chain = entries.length ? [] : panel && !stack.length ? [] : null;
    const seen = new Set<string>();
    for (const entry of entries) {
      const id = entry.getAttribute("data-chain-timeline-entry-id");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const surface = entry.querySelector("[data-chain-timeline-card]");
      const stackEntry = stack.find((item) => item.getAttribute("data-chain-entry-id") === id);
      const image = stackEntry?.querySelector("img[alt]") ?? entry.querySelector("img");
      const label = surface?.getAttribute("aria-label") ?? surface?.getAttribute("title") ?? "";
      const name = image?.getAttribute("alt")?.trim() || (/^(?:newest )?chain card:\s*/i.test(label) ? label.replace(/^(?:newest )?chain card:\s*/i, "").trim() : null);
      const hidden = !!entry.closest('[data-face-down="true"]') || !!entry.querySelector('[data-face-down="true"]') ||
        !!stackEntry?.matches('[data-face-down="true"]') || !!stackEntry?.querySelector('[data-face-down="true"]') || !!name && /card back|hidden card/i.test(name);
      const side = surface?.getAttribute("data-chain-timeline-owner");
      state.chain!.push({ id, position: count(entry.getAttribute("data-chain-timeline-position")),
        ownerId: side ? owners[side] ?? null : null, newest: bool(surface?.getAttribute("data-chain-timeline-newest") ?? null),
        hidden, name: hidden ? null : name,
        imageUrl: hidden || !name ? null : image?.getAttribute("data-card-art-source") || image?.getAttribute("src") || null,
        imageFallbackUrl: hidden || !name ? null : image?.getAttribute("src") ?? null });
    }
    state.chain?.sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
    state.battlefieldNames = {};
    state.battlefieldImages = {};
    // Board markers carry a zone ID; log mentions use "true" and cannot map a zone.
    for (const zone of ["battlefieldA", "battlefieldB"]) {
      const names = new Set(Array.from(document.querySelectorAll(`[data-battlefield-marker="${zone}"] img[alt]`))
        .map((image) => image.getAttribute("alt")?.trim()).filter((name): name is string => !!name && !/card back/i.test(name)));
      if (names.size === 1) state.battlefieldNames[zone] = [...names][0];
      const image = document.querySelector(`[data-battlefield-marker="${zone}"] img[alt]`);
      const art = image?.getAttribute("data-card-art-source") || image?.getAttribute("src");
      if (names.size === 1 && art) state.battlefieldImages[zone] = art;
    }
    // This overlay can be outside the board root. Explicit player ID, not self/opponent,
    // identifies its owner when spectator perspective changes.
    state.battlefieldMight = Array.from(document.querySelectorAll("[data-battlefield-might-zone]"), (element) => {
      const rawValue = element.querySelector("[data-battlefield-might-value]")?.getAttribute("data-battlefield-might-value") ?? null;
      const parsed = count(rawValue);
      return { zone: element.getAttribute("data-battlefield-might-zone"),
        playerId: element.getAttribute("data-battlefield-might-player"), side: element.getAttribute("data-might-side"),
        value: parsed !== null && Number.isSafeInteger(parsed) ? parsed : null, rawValue,
        ariaLabel: element.getAttribute("aria-label"), title: element.getAttribute("title") };
    }).sort((a, b) => `${a.zone}:${a.playerId}`.localeCompare(`${b.zone}:${b.playerId}`));
  }
  for (const divider of document.querySelectorAll('[data-match-log-turn-divider="true"]')) {
    const id = validId(divider.closest('[data-match-log-group="turn"]')?.getAttribute("data-turn-player-id"));
    if (!id) continue;
    for (const element of [divider, ...divider.querySelectorAll("span")]) {
      const style = document.defaultView?.getComputedStyle(element);
      for (const key of rgbKeys(`${element.getAttribute("class")} ${style?.color} ${style?.backgroundImage}`)) {
        const identities = palette.get(key) ?? new Set<string>(); identities.add(id); palette.set(key, identities);
      }
    }
  }
  const logs = Array.from(document.querySelectorAll("li"))
    .filter((row) => !row.querySelector("li") && row.querySelector("[data-log-action-kind], [data-log-action-placeholder]"))
    .reverse().map((row) => {
      const group = row.closest('[data-match-log-group="turn"]');
      const text = row.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const turn = count(group?.getAttribute("data-turn-number"));
      const marker = Array.from(row.querySelectorAll("span")).find((span) => /left-/.test(span.className) && /absolute/.test(span.className));
      const background = marker ? document.defaultView?.getComputedStyle(marker).backgroundColor ?? "" : "";
      const markerKeys = /(?:transparent|rgba\([^)]*,\s*0\s*\))/.test(background) ? [] : rgbKeys(background);
      if (!markerKeys.length && marker) markerKeys.push(...rgbKeys(marker.getAttribute("class") ?? ""));
      const identities = markerKeys.length ? palette.get(markerKeys[0]) : undefined;
      const actorId = identities?.size === 1 ? [...identities][0] : null;
      // Includes marker, timestamp and turn. Repeated rows stay separate occurrences.
      const key = JSON.stringify([turn, text, marker?.getAttribute("class") ?? ""]);
      return { key, text, turn, actorId };
    });
  return { formatVersion: 1, source: "riftatlas-board", sequence, capturedAt, sections: [...sections], state,
    cardScope: "visible-only", logs,
    metadata: { room: document.querySelector("[data-room-code]")?.getAttribute("data-room-code") ?? null,
      phase: root?.getAttribute("data-room-phase") ?? null,
      resetToken: root?.getAttribute("data-authoritative-reset-token") ?? null,
      authoritativeSequence: count(root?.getAttribute("data-authoritative-sequence")), url: document.URL } };
}
