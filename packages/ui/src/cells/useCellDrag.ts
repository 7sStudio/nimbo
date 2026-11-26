// Drag to reorder, as Jupyter's prompt and VS Code's cell gutter do: a press on a cell's number that
// moves a few pixels picks the cell up (a collapsed heading with its section); a line between two cells shows where it
// will land, the page scrolls near its edges, Escape cancels, and the drop is cell.move through the store
// (store/sections.ts dropAfter). A press that does not move stays a click on the number.
import type { CellId } from "@jsnb/core";
import type { Ref } from "vue";
import { onBeforeUnmount, ref } from "vue";

import type { useNotebookStore } from "../store/notebook.js";
import { dropAfter } from "../store/sections.js";

/** The page's .jsnb-ui root, which carries data-dragging: our styles stay inside it. */
const pageRoot = (): Element | null => document.querySelector(".jsnb-ui");

/** How far, in CSS pixels, a press moves before it becomes a drag. */
const threshold = 4;
/** The band at the scroller's top and bottom, as a share of its height, that scrolls the page while dragging. */
const edge = 0.08;

type Drop = { readonly before: CellId | null };

/** The scrolling ancestor of `element`, or the document's scroller. */
function scrollerOf(element: Element): Element {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight)
      return node;
  }
  return document.scrollingElement ?? document.documentElement;
}

/** How far `y` is into the scroller's top band (negative) or bottom band (positive); 0 between them. */
function intoEdge(scroller: Element, y: number): number {
  const box =
    scroller === document.scrollingElement
      ? { top: 0, height: window.innerHeight }
      : scroller.getBoundingClientRect();
  const band = box.height * edge;
  if (y < box.top + band) return y - (box.top + band);
  const bottom = box.top + box.height - band;
  return y > bottom ? y - bottom : 0;
}

/** Scrolls `scroller` each frame while the pointer (`y()`) is in one of its edge bands; returns the stop. */
function autoScroll(scroller: Element, y: () => number, scrolled: () => void): () => void {
  let frame = 0;
  const step = () => {
    const by = intoEdge(scroller, y());
    if (by !== 0) {
      scroller.scrollBy({ top: by / 3 });
      scrolled();
    }
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(frame);
  };
}

/** Swallows the click a drag ends with, once, so it neither folds nor selects what is under the pointer. */
function swallowClick(): void {
  const click = (clicked: MouseEvent) => {
    clicked.stopPropagation();
    clicked.preventDefault();
  };
  window.addEventListener("click", click, { capture: true, once: true });
  setTimeout(() => {
    window.removeEventListener("click", click, { capture: true });
  }, 0);
}

type Handlers = {
  readonly move: (event: PointerEvent) => void;
  readonly up: () => void;
  readonly key: (event: KeyboardEvent) => void;
};

/** Listens on the window for a press's moves, its release and Escape; returns the unlisten. */
function listen({ move, up, key }: Handlers): () => void {
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  window.addEventListener("keydown", key, true);
  return () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    window.removeEventListener("keydown", key, true);
  };
}

/** Where a pointer at `y` drops: before the first shown cell whose middle is below it. */
function dropAt(shown: readonly CellId[], y: number): Drop {
  for (const id of shown) {
    const box = document.querySelector(`[data-cell="${id}"]`)?.getBoundingClientRect();
    if (box !== undefined && y < box.top + box.height / 2) return { before: id };
  }
  return { before: null };
}

/** The drop as a move: `cell`'s block after the shown cell before the line (store/sections.ts dropAfter). */
function moveTo(
  store: ReturnType<typeof useNotebookStore>,
  shown: readonly CellId[],
  cell: CellId,
  at: Drop,
) {
  const index = at.before === null ? shown.length : shown.indexOf(at.before);
  const target = shown[index - 1] ?? null;
  void store.movePlanned(store.cellsInOrder, (order) =>
    dropAfter(
      order.flatMap((id) => store.byId.get(id) ?? []),
      cell,
      target,
    ),
  );
}

type Drag = {
  readonly dragging: Ref<CellId | null>;
  readonly drop: Ref<Drop | null>;
  readonly shown: () => readonly CellId[];
  readonly finish: (commit: boolean) => void;
};

/** Follows a press on `cell`'s number: past the threshold the cell lifts and the drop line follows the pointer (the page
 * scrolling near its edges); release drops it, Escape cancels. Returns what ends the tracking. */
function track(cell: CellId, event: PointerEvent, drag: Drag): () => void {
  const { dragging, drop, shown, finish } = drag;
  const start = { x: event.clientX, y: event.clientY };
  const scroller = scrollerOf(event.target instanceof Element ? event.target : document.body);
  let y = start.y;
  let stopScroll: (() => void) | null = null;
  const follow = () => {
    drop.value = dropAt(shown(), y);
  };
  const unlisten = listen({
    move: (moved) => {
      y = moved.clientY;
      if (dragging.value === null) {
        if (Math.hypot(moved.clientX - start.x, moved.clientY - start.y) < threshold) return;
        dragging.value = cell;
        pageRoot()?.setAttribute("data-dragging", "cell");
        stopScroll = autoScroll(scroller, () => y, follow);
      }
      moved.preventDefault();
      follow();
    },
    up: () => {
      finish(dragging.value !== null);
    },
    key: (pressed) => {
      if (pressed.key !== "Escape" || dragging.value === null) return;
      pressed.preventDefault();
      pressed.stopPropagation();
      finish(false);
    },
  });
  return () => {
    stopScroll?.();
    unlisten();
    pageRoot()?.removeAttribute("data-dragging");
    if (dragging.value !== null) swallowClick();
  };
}

export function useCellDrag(
  store: ReturnType<typeof useNotebookStore>,
  shown: () => readonly CellId[],
  off: () => boolean,
) {
  /** The cell being dragged, and the shown cell it would land before (null before nothing: at the end). */
  const dragging = ref<CellId | null>(null);
  const drop = ref<Drop | null>(null);
  let cleanup: (() => void) | null = null;

  const finish = (commit: boolean) => {
    const [cell, at] = [dragging.value, drop.value];
    cleanup?.();
    cleanup = null;
    dragging.value = null;
    drop.value = null;
    if (commit && cell !== null && at !== null) moveTo(store, shown(), cell, at);
  };

  onBeforeUnmount(() => {
    finish(false);
  });

  return {
    dragging,
    drop,
    /** A press on `cell`'s number: tracked until it drags or lets go. */
    press: (cell: CellId, event: PointerEvent) => {
      if (off() || event.button !== 0 || cleanup !== null) return;
      cleanup = track(cell, event, { dragging, drop, shown, finish });
    },
  };
}
