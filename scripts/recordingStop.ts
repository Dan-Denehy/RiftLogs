import { createInterface } from "node:readline";
import type { BrowserContext, Page } from "playwright";

// All stop requests share one promise; a closed browser is never a successful final flush.
export function createRecordingStop(options: {
  isClosed: () => boolean; flush: () => Promise<void>; close: () => Promise<void>;
}) {
  let pending: Promise<boolean> | undefined;
  let unexpectedlyClosed = false;
  let closing = false;
  return (reason: "stop" | "closed" = "stop"): Promise<boolean> => {
    if (reason === "closed" && !closing) unexpectedlyClosed = true;
    pending ??= (async () => {
      let complete = !unexpectedlyClosed && !options.isClosed();
      try { if (complete) await options.flush(); }
      catch (error) { complete = false; console.error("Final save did not finish:", error instanceof Error ? error.message : error); }
      complete &&= !unexpectedlyClosed && !options.isClosed();
      closing = true;
      await options.close().catch(() => undefined);
      return complete;
    })();
    return pending;
  };
}

export async function waitForRecordingStop(page: Page, context: BrowserContext, flush: () => Promise<void>) {
  console.log('Type stop and press Enter to save and stop. Keep Chrome open until saving finishes.');
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const stop = createRecordingStop({ isClosed: () => page.isClosed(), flush, close: () => context.close() });
  let cleanup = () => {};
  try { return await new Promise<boolean>((resolve) => {
    const request = (reason: "stop" | "closed") => { void stop(reason).then(resolve); };
    const signal = () => request("stop");
    const closed = () => request("closed");
    const line = (text: string) => {
      if (text.trim().toLowerCase() === "stop") signal();
      else console.log('To finish recording, type stop and press Enter.');
    };
    terminal.on("line", line);
    terminal.on("SIGINT", signal);
    terminal.on("close", signal);
    process.on("SIGINT", signal); process.on("SIGTERM", signal);
    page.on("close", closed); context.on("close", closed);
    cleanup = () => {
      terminal.removeAllListeners(); terminal.close();
      process.off("SIGINT", signal); process.off("SIGTERM", signal);
      page.off("close", closed); context.off("close", closed);
    };
    if (page.isClosed()) closed();
  }); } finally { cleanup(); }
}
