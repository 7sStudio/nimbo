// Where the note card goes beside its element: below it when there is room, else above it, else at the window's
// bottom; never off screen.
import type { Rect } from "../store/feedbackApi.js";

const gap = 8;

/** The card's start corner, as logical inset properties, for a card of `size` beside `anchor`. */
export function placeBeside(
  anchor: Rect,
  size: { readonly width: number; readonly height: number },
  window: { readonly innerWidth: number; readonly innerHeight: number },
): { insetInlineStart: string; insetBlockStart: string } {
  const below = anchor.y + anchor.height + gap;
  const above = anchor.y - gap - size.height;
  const fitsBelow = below + size.height <= window.innerHeight - gap;
  const y = fitsBelow
    ? below
    : above >= gap
      ? above
      : Math.max(gap, window.innerHeight - size.height - gap);
  const x = Math.min(Math.max(gap, anchor.x), Math.max(gap, window.innerWidth - size.width - gap));
  return { insetInlineStart: `${String(x)}px`, insetBlockStart: `${String(y)}px` };
}
