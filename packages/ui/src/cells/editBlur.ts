// What an editor's blur comes to: once the focus has settled, a click elsewhere on the
// page leaves edit mode; the focus on the cell's own markdown toolbar or in the menu it opened keeps it; a focus lost to
// nowhere after no press, or after a press in the cell's own row (a Move re-orders the list and the browser blurs the
// moved editor), goes back to the cell's editor, or leaves edit mode when the cell has none any more.
import type { CellId } from "@jsnb/core";

import type { useUiStore } from "../store/ui.js";

type Ui = ReturnType<typeof useUiStore>;

/** The last pointer press on the page: when (performance.now()) and in which cell's row, if any. */
export type Press = { readonly at: number; readonly cell: string | null };

let last: Press = { at: Number.NEGATIVE_INFINITY, cell: null };
let watching = false;

/** Listens for presses once, in the capture phase, from the first card on: a blur needs the press before it. */
export function watchPresses(): void {
  if (watching || typeof window === "undefined") return;
  watching = true;
  window.addEventListener(
    "pointerdown",
    (event) => {
      const row = event.target instanceof Element ? event.target.closest("[data-cell]") : null;
      last = { at: performance.now(), cell: row?.getAttribute("data-cell") ?? null };
    },
    { capture: true },
  );
}

/** A press this recent belongs to the blur that follows it. */
const pressMs = 1000;

export type BlurOutcome = "stay" | "refocus" | "leave";

/** What a blur sees once the focus settled: the page's mode and overlay, the focused element, the last press. */
export type Blurred = {
  readonly ui: Pick<Ui, "overlay" | "mode">;
  readonly active: Element | null;
  readonly press: Press;
  readonly now: number;
};

/** True when the focus stays with `cell`: its editor, its own markdown card's toolbar, or the menu it opened. */
function staysWith(cell: CellId, { ui, active }: Blurred): boolean {
  if (active?.closest(".cm-editor") != null) return true;
  const card = active?.closest('[data-part="markdown-card"]');
  if (card?.closest("[data-cell]")?.getAttribute("data-cell") === cell) return true;
  return ui.overlay !== null && "cell" in ui.overlay && ui.overlay.cell === cell;
}

/** What the blur of `cell`'s editor comes to. */
export function blurOutcome(cell: CellId, blurred: Blurred): BlurOutcome {
  if (staysWith(cell, blurred)) return "stay";
  const { ui, active, press, now } = blurred;
  const lost = active === null || active === active.ownerDocument.body;
  const pressedHere = now - press.at > pressMs || press.cell === cell;
  return lost && pressedHere && ui.mode === "edit" ? "refocus" : "leave";
}

/** After the focus settled: edit mode stays, goes back to the cell's editor, or leaves. */
export function leaveEditOnBlur(ui: Ui, cell: CellId): void {
  setTimeout(() => {
    if (!document.hasFocus() || ui.selected !== cell) return;
    const active = document.activeElement;
    const outcome = blurOutcome(cell, { ui, active, press: last, now: performance.now() });
    if (outcome === "stay") return;
    const row = [...document.querySelectorAll("[data-cell]")].find(
      (each) => each.getAttribute("data-cell") === cell,
    );
    const editor = outcome === "refocus" ? row?.querySelector<HTMLElement>(".cm-content") : null;
    if (editor == null) ui.setMode("command");
    else editor.focus();
  });
}
