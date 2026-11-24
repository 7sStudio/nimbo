// The one way a selection move scrolls the notebook. The scroller's scroll-padding-block-start stands for any sticky bar
// over the cells, so a revealed cell never lands under one.
import { remPx } from "../composables/useResize.js";

export type Span = { readonly top: number; readonly bottom: number };
export type Room = { readonly above: number; readonly below: number };

/** In rem; little above, since the item already holds the add gap over its card. */
const roomRem = { above: 0.25, below: 2.5 };

/** Pixels to scroll, positive down: the least move that shows `item` whole with the room kept, or, taller than that
 * room, the move that puts its top at the room's top. */
export function revealDelta(item: Span, view: Span, room: Room): number {
  const top = view.top + room.above;
  const bottom = view.bottom - room.below;
  if (item.bottom - item.top > bottom - top) return item.top - top;
  if (item.top < top) return item.top - top;
  if (item.bottom > bottom) return item.bottom - bottom;
  return 0;
}

export function tallerThan(item: Span, view: Span, room: Room): boolean {
  return item.bottom - item.top > view.bottom - view.top - room.above - room.below;
}

export function viewOf(scroller: HTMLElement): Span {
  const box = scroller.getBoundingClientRect();
  const cover = Number.parseFloat(getComputedStyle(scroller).scrollPaddingBlockStart) || 0;
  return { top: box.top + cover, bottom: box.top + scroller.clientHeight };
}

export function roomOf(): Room {
  const rem = remPx();
  return { above: roomRem.above * rem, below: roomRem.below * rem };
}

const motionMs = 150;
let frame = 0;

export function stopReveal(): void {
  if (frame !== 0) cancelAnimationFrame(frame);
  frame = 0;
}

export function reveal(scroller: HTMLElement, item: HTMLElement, smooth: boolean): void {
  stopReveal();
  const box = item.getBoundingClientRect();
  const delta = revealDelta({ top: box.top, bottom: box.bottom }, viewOf(scroller), roomOf());
  if (Math.abs(delta) < 1) return;
  const from = scroller.scrollTop;
  const to = Math.max(0, Math.min(from + delta, scroller.scrollHeight - scroller.clientHeight));
  if (!smooth || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    scroller.scrollTop = to;
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / motionMs);
    scroller.scrollTop = from + (to - from) * (1 - (1 - t) ** 3);
    frame = t < 1 ? requestAnimationFrame(step) : 0;
  };
  frame = requestAnimationFrame(step);
}
