// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import ReplayViewer from "./ReplayViewer";

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ReplayViewer />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === text)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
async function select(label: string, value: string) {
  const input = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  await act(async () => { input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); });
}

it("navigates the sample and shows checkpoint discrepancies", async () => {
  expect(container.querySelector('[aria-label="Player One Hand"]')).toBeNull();
  expect(container.querySelector<HTMLButtonElement>(".replay-toolbar button")?.disabled).toBe(true);
  await select("Replay action", "20");
  expect(container.querySelector('[aria-label="Checkpoint flags"]')?.textContent).toContain("cards.unit-1.zone");
  expect(container.querySelector('[aria-label="Player One Trash"]')?.textContent).toContain("Sample Scout");
  expect(container.querySelector('[aria-label="Player Two board"]')?.textContent).toContain("1 cards gained · 1 runes recycled");
  await click("Previous");
  expect(container.querySelector('[aria-label="Player One Battlefield A"]')?.textContent).toContain("Sample Scout");
});

it("allows local movement/tapping and restores recorded state on navigation", async () => {
  await select("Replay action", "3");
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>(".replay-card")!.click());
  await click("Untap selected card");
  await click("Tap selected card");
  expect(container.querySelector(".replay-card")?.classList.contains("is-tapped")).toBe(true);
  await select("Move selected card", "battlefieldB");
  expect(container.querySelector('[aria-label="Player One Battlefield B"]')?.textContent).toContain("Sample Scout");
  await click("Undo edit");
  expect(container.querySelector('[aria-label="Player One Base"]')?.textContent).toContain("Sample Scout");
  await click("Next");
  expect(container.querySelector(".replay-card.is-tapped")).not.toBeNull();
  expect(container.querySelector(".replay-badge")?.textContent).toBe("Recorded sample state");
});
