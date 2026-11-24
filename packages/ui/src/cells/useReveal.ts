// A revealed cell stays in view while the cells above it grow (a run's outputs arrive after ⇧↩ has already moved on),
// until the user scrolls, clicks in the page or presses a key that scrolls it.
import type { CellId } from "@jsnb/core";
import type { Ref } from "vue";
import { onScopeDispose, watch } from "vue";

import type { useUiStore } from "../store/ui.js";
import { reveal, roomOf, stopReveal, tallerThan, viewOf } from "./reveal.js";

/** Within this time of the last reveal a new one jumps rather than glides: a held or repeated key. */
const repeatMs = 250;
const scrollKeys = new Set(["PageUp", "PageDown", "Home", "End", " "]);

export const itemOf = (cell: CellId) =>
  document.querySelector<HTMLElement>(`[data-cell="${cell}"]`);
const scrollerOf = (item: HTMLElement) => item.closest<HTMLElement>("#page");

/** Calls `changed` when the list or its page changes size, and `scrolled` when the user scrolls the page, clicks in it
 * or presses a key that scrolls it. */
function watchUserScroll(
  list: Readonly<Ref<HTMLElement | null>>,
  changed: () => void,
  scrolled: () => void,
): void {
  const onKey = (event: KeyboardEvent) => {
    if (scrollKeys.has(event.key)) scrolled();
  };
  let resizes: ResizeObserver | null = null;
  let page: HTMLElement | null = null;
  const listen = (element: HTMLElement | null) => {
    resizes?.disconnect();
    resizes = null;
    page?.removeEventListener("wheel", scrolled);
    page?.removeEventListener("touchmove", scrolled);
    page?.removeEventListener("pointerdown", scrolled, { capture: true });
    document.removeEventListener("keydown", onKey, { capture: true });
    page = element?.closest<HTMLElement>("#page") ?? null;
    if (element === null || page === null) return;
    resizes = new ResizeObserver(changed);
    resizes.observe(element);
    resizes.observe(page);
    page.addEventListener("wheel", scrolled, { passive: true });
    page.addEventListener("touchmove", scrolled, { passive: true });
    page.addEventListener("pointerdown", scrolled, { capture: true });
    document.addEventListener("keydown", onKey, { capture: true });
  };
  watch(list, listen, { immediate: true, flush: "post" });
  onScopeDispose(() => {
    listen(null);
  });
}

export function useReveal(
  ui: ReturnType<typeof useUiStore>,
  list: Readonly<Ref<HTMLElement | null>>,
) {
  let following: CellId | null = null;
  let last = 0;
  // A tall cell being edited is left where the editor keeps its caret.
  const keep = () => {
    if (following === null || following !== ui.selected) return;
    const item = itemOf(following);
    const scroller = item === null ? null : scrollerOf(item);
    if (item === null || scroller === null) return;
    if (ui.mode === "edit" && tallerThan(item.getBoundingClientRect(), viewOf(scroller), roomOf()))
      return;
    reveal(scroller, item, false);
  };
  const release = () => {
    following = null;
    stopReveal();
  };
  watchUserScroll(list, keep, release);
  onScopeDispose(stopReveal);
  return {
    /** Reveals `item` and keeps it in view from now on. */
    show: (cell: CellId, item: HTMLElement) => {
      const scroller = scrollerOf(item);
      if (scroller !== null) {
        const now = performance.now();
        reveal(scroller, item, now - last > repeatMs);
        last = now;
      }
      following = cell;
    },
    release,
  };
}
