import path from "node:path";
import { createInterface } from "node:readline/promises";
import { chromium, type BrowserContext } from "playwright";
import { createDatabase } from "../server/database.ts";
import {
  LiveCaptureRecorder,
  type RawLiveAtlasEvent,
} from "../server/liveCaptureStore.ts";

type LatestAction = {
  timestamp: string | null;
  text: string;
  actionType: string | null;
  turnNumber: string | null;
  turnPlayerName: string | null;
  actorMarkerColor: string | null;
};

async function getRoomId() {
  const commandLineRoomId = process.argv[2]?.trim();
  if (commandLineRoomId) return commandLineRoomId;

  const prompts = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return (await prompts.question("RiftAtlas room ID: ")).trim();
  } finally {
    prompts.close();
  }
}

const roomId = await getRoomId();
if (!roomId) {
  console.error("A room ID is required to start the spectator probe.");
  process.exit(1);
}

const profileDirectory = path.resolve(".riftlogs-spectator-profile");
let context: BrowserContext;
try {
  context = await chromium.launchPersistentContext(profileDirectory, {
    channel: "chrome",
    headless: false,
    viewport: null,
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Opening in existing browser session")) {
    console.error(
      "The RiftLogs spectator browser is already running. Close that window before starting another probe.",
    );
    process.exit(1);
  }
  throw error;
}

const existingPages = context.pages();
const page =
  existingPages.find((candidate) => candidate.url() !== "about:blank") ??
  existingPages[0] ??
  (await context.newPage());

await page.exposeBinding(
  "reportRiftLogsAction",
  (_source, action: LatestAction) => {
    const time = action.timestamp ? ` at ${action.timestamp}` : "";
    const turn = action.turnNumber ? `Turn ${action.turnNumber}` : "Unknown turn";
    const turnPlayer = action.turnPlayerName
      ? ` (${action.turnPlayerName}'s turn)`
      : "";
    const type = action.actionType ? ` [${action.actionType}]` : "";

    console.log(`\nLatest action${time}: ${action.text}`);
    console.log(`${turn}${turnPlayer}${type}`);
    if (action.actorMarkerColor) {
      console.log(`Actor marker: ${action.actorMarkerColor}`);
    }
  },
);

console.log("Opening RiftAtlas in the dedicated spectator profile…");
await page.goto("https://play.riftatlas.com/game", {
  waitUntil: "domcontentloaded",
});
await page.bringToFront();
console.log(`RiftAtlas page opened at ${page.url()}`);
console.log(`Joining room ${roomId} as a spectator...`);

const matchLog = page.locator(
  '[data-match-log-group], li:has([data-log-action-placeholder="true"])',
);
if (!(await matchLog.first().isVisible().catch(() => false))) {
  const spectateButton = page
    .getByRole("button", { name: /spectate/i })
    .first();

  await spectateButton.waitFor({ state: "visible", timeout: 120_000 });
  await spectateButton.click();

  const namedRoomInput = page.locator(
    'input[aria-label*="room" i], input[placeholder*="room" i], input[name*="room" i], input[id*="room" i]',
  );
  const roomInput = (await namedRoomInput.first().isVisible().catch(() => false))
    ? namedRoomInput.first()
    : page.getByRole("textbox").last();

  await roomInput.waitFor({ state: "visible", timeout: 30_000 });
  await roomInput.fill(roomId);

  const containingForm = page.locator("form").filter({ has: roomInput });
  const joinButton = (await containingForm.isVisible().catch(() => false))
    ? containingForm.getByRole("button", { name: /spectate|join|watch/i }).last()
    : page.getByRole("button", { name: /spectate|join|watch/i }).last();

  if (await joinButton.isVisible().catch(() => false)) {
    await joinButton.click();
  } else {
    await roomInput.press("Enter");
  }
}

console.log("Waiting for the RiftAtlas match log…");

await page
  .locator('[data-match-log-group], li:has([data-log-action-placeholder="true"])')
  .first()
  .waitFor({ state: "attached", timeout: 0 });

const database = createDatabase();
const recorder = LiveCaptureRecorder.start(database.db, {
  roomId,
  sourceUrl: page.url(),
});

await page.exposeBinding(
  "recordRiftLogsEvents",
  (_source, events: RawLiveAtlasEvent[]) => {
    const sequences = recorder.append(events);
    if (sequences.length > 0) {
      console.log(
        `Saved ${sequences.length} raw event${sequences.length === 1 ? "" : "s"} ` +
          `to capture #${recorder.captureId} (through sequence ${sequences.at(-1)}).`,
      );
    }
    return sequences;
  },
);

console.log(`Recording live capture #${recorder.captureId} in riftlogs.db.`);

const foundInitialAction = await page.evaluate(async () => {
  type ActionReporter = (action: LatestAction) => Promise<void>;
  type EventRecorder = (events: RawLiveAtlasEvent[]) => Promise<number[]>;
  const bindings = window as unknown as {
    reportRiftLogsAction: ActionReporter;
    recordRiftLogsEvents: EventRecorder;
  };
  const report = bindings.reportRiftLogsAction;
  const record = bindings.recordRiftLogsEvents;

  let previousRows: HTMLElement[] | null = null;
  let previousSignatures: string[] = [];
  let scanTimer: number | undefined;

  const findNarrowMarker = (row: Element) =>
    Array.from(row.querySelectorAll<HTMLElement>("span")).find((span) => {
      const className = span.getAttribute("class") ?? "";
      if (
        className.includes("absolute") &&
        className.includes("left-") &&
        (className.includes("w-[0.1rem]") || className.includes("rounded-full"))
      ) {
        return true;
      }

      const computed = getComputedStyle(span);
      const width = Number.parseFloat(computed.width);
      return (
        computed.position === "absolute" &&
        Number.isFinite(width) &&
        width > 0 &&
        width <= 4
      );
    }) ?? null;

  const actionRows = () =>
    [...new Set([
      ...document.querySelectorAll<HTMLElement>("[data-match-log-group] li"),
      ...document.querySelectorAll<HTMLElement>(
        'li:has([data-log-action-placeholder="true"])',
      ),
    ])].filter(
      (candidate) =>
        candidate.querySelector("[data-log-action-kind]") !== null ||
        candidate.querySelector('[data-log-action-placeholder="true"]') !== null ||
        findNarrowMarker(candidate) !== null,
    );

  const attributesOf = (element: Element) =>
    Object.fromEntries(
      Array.from(element.attributes, ({ name, value }) => [name, value]),
    );

  const rawSnapshotOf = (element: HTMLElement) => ({
    tagName: element.tagName.toLowerCase(),
    rawText: element.textContent ?? "",
    visibleText: element.innerText ?? "",
    attributes: attributesOf(element),
    outerHTML: element.outerHTML,
  });

  const timestampFrom = (row: HTMLElement) =>
    Array.from(row.querySelectorAll("span"))
      .map((element) => element.textContent?.trim() ?? "")
      .find((text) => /^\d{1,2}:\d{2}$/.test(text)) ?? null;

  const eventFrom = (row: HTMLElement): RawLiveAtlasEvent => {
    const logGroup = row.closest<HTMLElement>("[data-match-log-group]");
    const turnElement = row.closest<HTMLElement>(
      '[data-match-log-group="turn"]',
    );
    const divider = turnElement?.querySelector<HTMLElement>(
      '[data-match-log-turn-divider="true"]',
    );
    const ariaLabel =
      turnElement?.getAttribute("aria-label") ??
      turnElement
        ?.querySelector("section[aria-label]")
        ?.getAttribute("aria-label") ??
      null;
    const dividerText = divider?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const dividerMatch = dividerText.match(/turn\s+(\d+)\s*[·•]\s*(.+)$/i);
    const ariaMatch = ariaLabel?.match(/^turn\s+(\d+)\s*,\s*(.+)$/i);
    const actionTypeMarker = row.querySelector<HTMLElement>(
      "[data-log-action-kind]",
    );
    const actorMarker = findNarrowMarker(row);
    const timestamp = timestampFrom(row);
    const rawText = row.textContent ?? "";
    const relevantElements = Array.from(
      row.querySelectorAll<HTMLElement>(
        "[data-log-card-name], [data-log-card-art], [data-battlefield-marker], [aria-label]",
      ),
      rawSnapshotOf,
    );

    return {
      format: "riftlogs-atlas-live-event",
      formatVersion: 1,
      capturedAt: new Date().toISOString(),
      source: {
        kind: "riftatlas-live-dom",
        url: location.href,
        pageTitle: document.title,
      },
      group: {
        kind: logGroup?.getAttribute("data-match-log-group") ?? "setup",
        attributes: logGroup ? attributesOf(logGroup) : {},
      },
      turn: {
        turnNumber:
          turnElement?.getAttribute("data-turn-number") ??
          dividerMatch?.[1] ??
          ariaMatch?.[1] ??
          null,
        turnPlayerId: turnElement?.getAttribute("data-turn-player-id") ?? null,
        turnPlayerName: dividerMatch?.[2]?.trim() ?? ariaMatch?.[2]?.trim() ?? null,
        ariaLabel,
        attributes: turnElement ? attributesOf(turnElement) : {},
        divider: divider
          ? {
              ...rawSnapshotOf(divider),
              computedStyle: {
                color: getComputedStyle(divider).color,
                backgroundColor: getComputedStyle(divider).backgroundColor,
                backgroundImage: getComputedStyle(divider).backgroundImage,
                boxShadow: getComputedStyle(divider).boxShadow,
                borderColor: getComputedStyle(divider).borderColor,
              },
            }
          : null,
      },
      action: {
        ...rawSnapshotOf(row),
        actionType:
          actionTypeMarker?.getAttribute("data-log-action-kind") ?? null,
        actionLabel:
          actionTypeMarker?.getAttribute("data-log-action-label") ?? null,
        timestamp,
        text: timestamp ? rawText.replace(timestamp, "").trim() : rawText.trim(),
        actorMarker: actorMarker
          ? {
              ...rawSnapshotOf(actorMarker),
              backgroundColor: getComputedStyle(actorMarker).backgroundColor,
            }
          : null,
        relevantElements,
      },
    };
  };

  const newestRowsNotPreviouslySeen = (rows: HTMLElement[]) => {
    if (previousRows === null) return [...rows].reverse();

    const firstRetainedRow = rows.findIndex((row) => previousRows?.includes(row));
    if (firstRetainedRow >= 0) return rows.slice(0, firstRetainedRow).reverse();

    const signatures = rows.map((row) => row.outerHTML);
    let overlap = Math.min(previousSignatures.length, signatures.length);
    while (
      overlap > 0 &&
      !previousSignatures
        .slice(0, overlap)
        .every(
          (signature, index) =>
            signature === signatures[signatures.length - overlap + index],
        )
    ) {
      overlap -= 1;
    }

    return rows.slice(0, rows.length - overlap).reverse();
  };

  const scan = async () => {
    // RiftAtlas renders its retained action rows newest-first.
    const rows = actionRows();
    const newRows = newestRowsNotPreviouslySeen(rows);
    previousRows = rows;
    previousSignatures = rows.map((row) => row.outerHTML);

    if (newRows.length === 0) return rows.length > 0;

    const events = newRows.map(eventFrom);
    await record(events);
    const latest = events.at(-1);
    const turn = latest?.turn as Record<string, unknown> | undefined;
    const action = latest?.action as Record<string, unknown> | undefined;
    const actorMarker = action?.actorMarker as Record<string, unknown> | null;

    await report({
      timestamp: typeof action?.timestamp === "string" ? action.timestamp : null,
      text: typeof action?.text === "string" ? action.text : "Unknown action",
      actionType:
        typeof action?.actionType === "string" ? action.actionType : null,
      turnNumber:
        typeof turn?.turnNumber === "string" ? turn.turnNumber : null,
      turnPlayerName:
        typeof turn?.turnPlayerName === "string" ? turn.turnPlayerName : null,
      actorMarkerColor:
        typeof actorMarker?.backgroundColor === "string"
          ? actorMarker.backgroundColor
          : null,
    });

    return true;
  };

  const foundAction = await scan();
  const observer = new MutationObserver(() => {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => void scan(), 75);
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  return foundAction;
});

if (foundInitialAction) {
  console.log("Latest retained action printed above. Watching for new actions.");
} else {
  console.log("Match log detected, but it has no action yet. Watching for the first action.");
}
console.log("Close the browser or press Ctrl+C to stop.");

await new Promise<void>((resolve) => {
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log("\nStopping spectator probe…");
    await context.close().catch(() => undefined);
    resolve();
  };

  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  page.once("close", () => resolve());
});

recorder.complete();
database.close();
console.log(`Live capture #${recorder.captureId} completed and saved.`);
