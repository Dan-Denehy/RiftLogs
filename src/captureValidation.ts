import type { AtlasCapture } from "./atlasCapture.ts";
import type { CompactObservation } from "./boardObservation.ts";

export const MAX_CAPTURE_BYTES = 10 * 1024 * 1024;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown) => typeof value === "string";
const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const optional = (value: unknown, check: (value: unknown) => boolean) => value == null || check(value);
const strings = (value: Record<string, unknown>, keys: string[]) => keys.every((key) => optional(value[key], string));
const integers = (value: Record<string, unknown>, keys: string[]) => keys.every((key) => optional(value[key], integer));
const turnNumber = (value: unknown) => optional(value, (item) => integer(item) || typeof item === "string" && /^\d{1,6}$/.test(item));
const list = (value: unknown, check: (value: unknown) => boolean, max = 2000) => Array.isArray(value) && value.length <= max && value.every(check);

// Bound nested extension/raw fields as well as fields the interpreter understands.
export function boundedJson(value: unknown): boolean {
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++nodes > 100_000 || item.depth > 20) return false;
    if (typeof item.value === "string" && item.value.length > 2_000_000) return false;
    if (item.value && typeof item.value === "object") {
      for (const [key, child] of Object.entries(item.value)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) return false;
        pending.push({ value: child, depth: item.depth + 1 });
      }
    }
  }
  return true;
}

function action(value: unknown): boolean {
  if (!object(value) || !strings(value, ["turnPlayerName", "turnPlayerId", "actorPlayerName", "actorPlayerId", "actorMarkerColor", "actorColorKey", "actionType", "text", "rawHtml", "outerHTML", "actionKind", "capturedAt", "rawText", "visibleText", "actionLabel", "timestamp"]) ||
      !integers(value, ["sequence", "turnSequence", "captureSequence"]) || !turnNumber(value.turnNumber)) return false;
  if (!optional(value.actorResolution, (item) => item === "color-marker" || item === "unknown")) return false;
  if (!optional(value.attributes, (item) => object(item) && Object.values(item).every(string))) return false;
  if (!optional(value.cards, (items) => list(items, (item) => object(item) && strings(item, ["name", "art", "ariaLabel"])))) return false;
  if (!optional(value.battlefieldMarkers, (items) => list(items, (item) => object(item) && strings(item, ["marker"])))) return false;
  if (!optional(value.observedScores, (items) => list(items, (item) => object(item) && string(item.label) && string(item.rawHtml) && integer(item.score) &&
      ["your", "opponent", "unknown"].includes(String(item.perspective)) && strings(item, ["playerName"])))) return false;
  return optional(value.observedTrashCards, (items) => list(items, (item) => object(item) && integer(item.zoneIndex) && string(item.name) && string(item.rawHtml) && strings(item, ["cardId", "zoneOwner", "playerName"])));
}

export function validAtlasCapture(value: unknown): value is AtlasCapture {
  if (!object(value) || !boundedJson(value) || !strings(value, ["capturedAt"])) return false;
  const modern = value.format === "riftlogs-atlas-dom-capture" && value.formatVersion === 1;
  const legacy = value.format === undefined && value.source === "riftatlas-dom";
  if (!modern && !legacy) return false;
  if (!optional(value.order, (item) => item === "chronological" || item === "newest-first")) return false;
  let total = 0;
  return list(value.turns, (turn) => {
    if (!object(turn) || !integers(turn, ["sequence"]) || !turnNumber(turn.turnNumber) ||
        !strings(turn, ["turnPlayerId", "turnPlayerName", "turnColorKey", "playerId", "playerName", "ariaLabel"]) ||
        !optional(turn.playerTone, (item) => ["green", "yellow", "unknown"].includes(String(item)))) return false;
    if (legacy) {
      if (!string(turn.html)) return false;
      const count = ((turn.html as string).match(/<li\b/gi) ?? []).length;
      total += count;
      return count <= 2000 && total <= 10_000;
    }
    if (!list(turn.actions, action)) return false;
    total += (turn.actions as unknown[]).length;
    return total <= 10_000;
  }, 500);
}

export function readAtlasCapture(rawJson: string): AtlasCapture {
  if (new TextEncoder().encode(rawJson).byteLength > MAX_CAPTURE_BYTES) throw new Error("Capture exceeds the 10 MiB limit.");
  const value: unknown = JSON.parse(rawJson);
  if (!validAtlasCapture(value)) throw new Error("Unsupported or malformed Atlas capture, or capture limits exceeded (500 turns / 10,000 actions).");
  return value;
}

export function validBoardObservation(value: unknown): value is CompactObservation {
  if (!object(value) || !boundedJson(value) || value.source !== "riftatlas-board" || value.formatVersion !== 1 ||
      !integer(value.sequence) || value.sequence === 0 || !string(value.capturedAt) || !object(value.metadata) || !object(value.state)) return false;
  const meta = value.metadata; const state = value.state;
  if (!strings(meta, ["room", "phase", "resetToken", "url"]) || !optional(meta.authoritativeSequence, integer)) return false;
  if (!list(value.sections, (item) => typeof item === "string" && ["cards", "scores", "resources", "context"].includes(item), 4)) return false;
  if (!list(value.logs, (item) => object(item) && string(item.key) && string(item.text) && optional(item.turn, integer) && strings(item, ["actorId"]), 1000)) return false;
  if (!object(state.context) || !optional(state.context.turn, integer) || !strings(state.context, ["activePlayerId"])) return false;
  if (!object(state.players) || Object.keys(state.players).length > 4 || !Object.values(state.players).every(string)) return false;
  if (!object(state.scores) || !Object.values(state.scores).every((item) => optional(item, integer))) return false;
  if (!object(state.resources) || !Object.values(state.resources).every((item) => object(item) && ["ready", "used", "hand", "deck"].every((key) => optional(item[key], integer)))) return false;
  if (state.cards !== null && !list(state.cards, (card) => object(card) && ["id", "ownerId", "zone"].every((key) => string(card[key])) &&
      strings(card, ["name", "attachedTo", "imageUrl", "imageFallbackUrl"]) && ["hidden", "exhausted"].every((key) => optional(card[key], (item) => typeof item === "boolean")), 1000)) return false;
  if (!optional(state.chain, (items) => list(items, (entry) => object(entry) && string(entry.id) && strings(entry, ["ownerId", "name", "imageUrl", "imageFallbackUrl"]) &&
      optional(entry.position, integer) && typeof entry.hidden === "boolean" && optional(entry.newest, (item) => typeof item === "boolean"), 100))) return false;
  for (const field of ["battlefieldNames", "battlefieldImages"]) if (!optional(state[field], (item) => object(item) && Object.values(item).every(string))) return false;
  if (!optional(state.battlefieldMight, (items) => list(items, (item) => object(item) && strings(item, ["zone", "playerId", "side", "rawValue", "ariaLabel", "title"]) && optional(item.value, integer), 20))) return false;
  return true;
}
