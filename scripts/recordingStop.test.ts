import { expect, it, vi } from "vitest";
import { createRecordingStop } from "./recordingStop.ts";

it("flushes before closing and shares one stop for repeated requests", async () => {
  const order: string[] = [];
  const stop = createRecordingStop({ isClosed: () => false,
    flush: async () => { order.push("flush"); }, close: async () => { order.push("close"); } });
  const first = stop();
  expect(stop()).toBe(first);
  expect(await first).toBe(true);
  expect(order).toEqual(["flush", "close"]);
});
it("does not report a closed browser as a complete capture", async () => {
  const flush = vi.fn(async () => {});
  const stop = createRecordingStop({ isClosed: () => true, flush, close: async () => {} });
  expect(await stop("closed")).toBe(false);
  expect(flush).not.toHaveBeenCalled();
});
it("reports a close during final saving as interrupted", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const stop = createRecordingStop({ isClosed: () => false, flush: () => pending, close: async () => {} });
  const result = stop(); stop("closed"); release();
  expect(await result).toBe(false);
});
it("still closes after a save failure but does not claim completion", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const close = vi.fn(async () => {});
  try {
    const stop = createRecordingStop({ isClosed: () => false, flush: async () => { throw new Error("disk full"); }, close });
    expect(await stop()).toBe(false); expect(close).toHaveBeenCalledOnce();
  } finally { log.mockRestore(); }
});
