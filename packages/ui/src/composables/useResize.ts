// A workbench region's resizer: the gap beside the region is its grip. A pointer drag measures from the window edge the
// region sits at, and the keyboard is a window splitter's (WAI-ARIA): the arrow that points away from that edge grows
// the region by 1 rem, the one toward it shrinks it, Home and End go to the bounds, Enter back to the default. Sizes
// are rem; the caller clamps and stores them.

/** The window edge a region sits at: the side panel at the left, the inspector at the right, the bottom panel below. */
export type Edge = "left" | "right" | "bottom";
type Bounds = { readonly min: number; readonly max: number };

const grows: Readonly<Record<Edge, string>> = {
  left: "ArrowRight",
  right: "ArrowLeft",
  bottom: "ArrowUp",
};
const shrinks: Readonly<Record<Edge, string>> = {
  left: "ArrowLeft",
  right: "ArrowRight",
  bottom: "ArrowDown",
};

/** What a key does to the size `now` (rem) of a region at `edge`: a new size, "default", or undefined for a key it
 * ignores. */
export function keySize(
  key: string,
  now: number,
  bounds: Bounds,
  edge: Edge,
): number | "default" | undefined {
  if (key === grows[edge]) return now + 1;
  if (key === shrinks[edge]) return now - 1;
  if (key === "Home") return bounds.min;
  if (key === "End") return bounds.max;
  if (key === "Enter") return "default";
  return undefined;
}

/** The root's font size in px: what 1 rem is now (the user's browser setting or zoom may change it). */
export const remPx = (): number =>
  typeof document === "undefined"
    ? 16
    : Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/** The size of `element` in rem along the axis its edge resizes: a height at the bottom, a width at a side. */
export function sizeOf(element: Element, edge: Edge): number {
  const box = element.getBoundingClientRect();
  return (edge === "bottom" ? box.height : box.width) / remPx();
}

/** The size (rem) a pointer at `point` gives a region whose box is `box`: from its window edge to the pointer. */
export function dragSize(
  box: Pick<DOMRect, "left" | "right" | "bottom">,
  point: { readonly clientX: number; readonly clientY: number },
  edge: Edge,
  rem: number,
): number {
  if (edge === "left") return (point.clientX - box.left) / rem;
  if (edge === "right") return (box.right - point.clientX) / rem;
  return (box.bottom - point.clientY) / rem;
}

export function useResize(
  region: () => HTMLElement | null,
  options: { readonly edge: Edge; readonly bounds: Bounds },
  resize: (rem: number | null) => void,
) {
  const { edge, bounds } = options;
  return {
    /** Starts a drag; the pointer is captured so a fast move off the grip keeps resizing. */
    onPointerDown: (event: PointerEvent) => {
      const element = region();
      const handle = event.currentTarget;
      if (element === null || event.button !== 0 || !(handle instanceof HTMLElement)) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const box = element.getBoundingClientRect();
      const move = (next: PointerEvent) => {
        resize(dragSize(box, next, edge, remPx()));
      };
      const stop = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    },
    onKeyDown: (event: KeyboardEvent) => {
      const element = region();
      if (element === null) return;
      const next = keySize(event.key, sizeOf(element, edge), bounds, edge);
      if (next === undefined) return;
      event.preventDefault();
      resize(next === "default" ? null : next);
    },
    /** A double click puts the default size back. */
    onDoubleClick: () => {
      resize(null);
    },
  };
}
