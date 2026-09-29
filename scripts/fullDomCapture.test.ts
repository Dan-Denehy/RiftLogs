// @vitest-environment jsdom
import { expect, it } from "vitest";
import { observeFullDom } from "./fullDomCapture.ts";

it("keeps initial DOM, removed log entries, and the next game's reset", async () => {
  const events: Array<Record<string, unknown>> = [];
  const captureWindow = window as unknown as {
    reportFullDom: (event: Record<string, unknown>) => Promise<void>;
    stopFullDom: () => Promise<void>;
  };
  captureWindow.reportFullDom = async (event) => { events.push(event); };
  document.body.innerHTML = '<main><li data-event="1">Scored 8</li><img alt="Card" src="/card.webp"></main>';
  observeFullDom();
  if (document.readyState === "loading") document.dispatchEvent(new Event("DOMContentLoaded"));
  try {
    document.querySelector("li")!.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.querySelector("main")!.innerHTML = '<li>Finalized mulligan for game 2</li>';
    await new Promise((resolve) => setTimeout(resolve, 0));
    await captureWindow.stopFullDom();
    expect(events[0].kind).toBe("snapshot");
    expect(events[0].html).toContain('/card.webp');
    expect(JSON.stringify(events.filter((event) => event.kind === "mutations"))).toContain('Scored 8');
    expect(events.at(-1)?.html).toContain("Finalized mulligan for game 2");
  } finally {
    await captureWindow.stopFullDom();
  }
});
