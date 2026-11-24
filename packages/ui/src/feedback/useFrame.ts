// Where the feedback layer draws, one animation frame at a time while it is mounted, so its boxes follow scrolling,
// resizing and the page changing under them: the hovered element's box and name, the open note's box, and the pins of
// this page's open entries where their selectors still find their elements.
import type { Ref, ShallowRef } from "vue";
import { onBeforeUnmount, onMounted, shallowRef } from "vue";

import type { Note } from "../store/feedback.js";
import type { FeedbackEntry, Rect } from "../store/feedbackApi.js";
import { componentsOf } from "./components.js";
import { pageNow } from "./draft.js";

export type Pin = { readonly entry: FeedbackEntry; readonly number: number; readonly rect: Rect };

type Frame = {
  readonly hover: Rect | null;
  readonly hoverName: string;
  readonly note: Rect | null;
  readonly pins: readonly Pin[];
};

const rectOf = (element: Element | null | undefined): Rect | null => {
  if (!element?.isConnected) return null;
  const box = element.getBoundingClientRect();
  return { x: box.x, y: box.y, width: box.width, height: box.height };
};

/** The element `selector` finds, or null (a selector a hand edit broke included). */
export function find(selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

const near = (a: Rect, b: Rect) =>
  Math.abs(a.x + a.width - (b.x + b.width)) < 20 && Math.abs(a.y - b.y) < 20;

/** The open entries of this page, numbered oldest first, where their elements are; pins of one element (or of
 * neighbours) line up leftwards instead of covering each other. */
function pinsOf(open: readonly FeedbackEntry[]): Pin[] {
  const path = pageNow().path;
  const placed: Pin[] = [];
  [...open].reverse().forEach((entry, at) => {
    const rect = entry.page.path === path ? rectOf(find(entry.selector)) : null;
    if (rect === null) return;
    const before = placed.filter((other) => near(other.rect, rect)).length;
    placed.push({ entry, number: at + 1, rect: { ...rect, width: rect.width - before * 22 } });
  });
  return placed;
}

/** The hovered element's name, `HomeRow div`, kept while the pointer stays on it. */
function namer() {
  let last: { element: Element | null; name: string } = { element: null, name: "" };
  return (element: Element | null): string => {
    if (element === last.element) return last.name;
    const name =
      element === null ? "" : `${componentsOf(element).at(-1) ?? ""} ${element.localName}`.trim();
    last = { element, name };
    return name;
  };
}

export function useFrame(state: {
  readonly hovered: ShallowRef<Element | null>;
  readonly dragged: ShallowRef<Rect | null>;
  readonly note: Readonly<Ref<Note | null>>;
  readonly open: Readonly<Ref<readonly FeedbackEntry[]>>;
}) {
  const empty: Frame = { hover: null, hoverName: "", note: null, pins: [] };
  const frame = shallowRef(empty);
  const nameOf = namer();
  let raf = 0;
  const tick = () => {
    const note = state.note.value;
    const hover = note === null && state.dragged.value === null ? state.hovered.value : null;
    frame.value = {
      hover: rectOf(hover),
      hoverName: nameOf(hover),
      note: note === null ? null : (note.area ?? rectOf(note.element) ?? note.located.element.rect),
      pins: pinsOf(state.open.value),
    };
    raf = requestAnimationFrame(tick);
  };
  onMounted(() => {
    raf = requestAnimationFrame(tick);
  });
  onBeforeUnmount(() => {
    cancelAnimationFrame(raf);
  });
  return frame;
}
