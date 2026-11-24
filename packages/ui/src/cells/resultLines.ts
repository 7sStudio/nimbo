// How many lines a cell's result has and which of them are in view: a long result stops at
// seven lines and scrolls in place, its footer saying "Lines 1 to 7 of 42"; expanded, the page scrolls through it and
// the cell header stays in view. The lines are the rows the output viewer draws: the tree's (1.25rem each), the grid's
// (1.5rem, under its header row) or the raw text's and a stream's lines, read from the view's scroller
// (`[data-part="tree"]` and its siblings, the viewer's own parts that the page already reads).
import type { Ref } from "vue";
import { onBeforeUnmount, ref, watch } from "vue";

import { remPx } from "../composables/useResize.js";

/** The first and last line in view, 1-based, how many there are, and whether the view's own height cuts them (the
 * cap: its scroller scrolls). */
export type Lines = {
  readonly first: number;
  readonly last: number;
  readonly total: number;
  readonly cut: boolean;
};

/** The result stops at this many lines while it is capped (the cap in rem is `capRem`). */
export const capLines = 7;
/** Seven of the tree's 1.25rem rows and the 0.125rem of room above the first and below the last. */
export const capRem = capLines * 1.25 + 0.25;

const scrollers = '[data-part="tree"], [data-part="grid"], [data-part="raw"], [data-part="stream"]';

/** The height of one line of `scroller` in px: a virtual list's row, else the text's line height. */
function rowOf(scroller: HTMLElement, body: HTMLElement | null): number {
  if (body !== null) return (body.dataset.part === "grid-body" ? 1.5 : 1.25) * remPx();
  const style = getComputedStyle(scroller);
  return Number.parseFloat(style.lineHeight) || 1.3 * remPx();
}

/** The lines of the view in `root` the footer is about, and those inside both its scroller and `view` (the page's
 * scroller, or the window); null when there is no view or it has no lines. A result of several outputs (a printed
 * line, then the value) is about the first one the cap cuts, else the longest, so a short line before a long value
 * never hides the long value's footer. */
export function linesOf(root: HTMLElement, view: DOMRect): Lines | null {
  const each = [...root.querySelectorAll<HTMLElement>(scrollers)]
    .map((scroller) => linesIn(scroller, view))
    .filter((lines) => lines !== null);
  return each.find((lines) => lines.cut) ?? each.toSorted((a, b) => b.total - a.total)[0] ?? null;
}

/** The lines of one view's `scroller`, as linesOf says them. */
function linesIn(scroller: HTMLElement, view: DOMRect): Lines | null {
  const body = scroller.querySelector<HTMLElement>('[data-part$="-body"]');
  const row = rowOf(scroller, body);
  const box = scroller.getBoundingClientRect();
  const style = getComputedStyle(scroller);
  const pad = Number.parseFloat(style.paddingBlockStart) || 0;
  const top = body === null ? box.top - scroller.scrollTop + pad : body.getBoundingClientRect().top;
  const height =
    body === null
      ? scroller.scrollHeight - pad - (Number.parseFloat(style.paddingBlockEnd) || 0)
      : body.offsetHeight;
  const total = Math.round(height / row);
  if (total < 1) return null;
  const clamp = (line: number) => Math.min(total, Math.max(1, line));
  const first = clamp(Math.round((Math.max(box.top, view.top) - top) / row) + 1);
  const last = clamp(Math.round((Math.min(box.bottom, view.bottom) - top) / row));
  const cut = scroller.scrollHeight > scroller.clientHeight + 1;
  return { first, last: Math.max(first, last), total, cut };
}

const same = (a: Lines | null, b: Lines | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.first === b.first &&
    a.last === b.last &&
    a.total === b.total &&
    a.cut === b.cut);

/** Calls `soon` whenever `element`, its view or the page around it scrolls, resizes or changes; answers the detach. */
function follow(element: HTMLElement, soon: () => void): () => void {
  const page = element.closest("#page");
  const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(soon);
  const changes = typeof MutationObserver === "undefined" ? undefined : new MutationObserver(soon);
  page?.addEventListener("scroll", soon, { passive: true });
  element.addEventListener("scroll", soon, { capture: true, passive: true });
  resize?.observe(element);
  changes?.observe(element, { childList: true, subtree: true });
  return () => {
    page?.removeEventListener("scroll", soon);
    element.removeEventListener("scroll", soon, { capture: true });
    resize?.disconnect();
    changes?.disconnect();
  };
}

/** The lines of the result under `root`, measured again whenever it, its view or the page scrolls or changes. */
export function useResultLines(root: Readonly<Ref<HTMLElement | null>>) {
  const lines = ref<Lines | null>(null);
  let frame = 0;
  const measure = () => {
    frame = 0;
    const element = root.value;
    const page = element?.closest("#page") ?? null;
    const view = page?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
    const next = element === null ? null : linesOf(element, view);
    if (!same(next, lines.value)) lines.value = next;
  };
  const soon = () => {
    if (frame === 0) frame = requestAnimationFrame(measure);
  };
  const none = (): void => undefined;
  let detach = none;
  // Side effects: the observers and the scroll listeners follow the result while it is shown; they stop with it.
  watch(
    root,
    (element) => {
      detach();
      detach = element === null ? none : follow(element, soon);
      measure();
    },
    { immediate: true, flush: "post" },
  );
  onBeforeUnmount(() => {
    if (frame !== 0) cancelAnimationFrame(frame);
    detach();
  });
  return lines;
}
