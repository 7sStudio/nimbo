// Where a menu of store/overlay.ts places itself: the control it was opened from, found by its data
// attributes, or the point a right-click gave; and the element the focus goes back to when it closes:
// the one that had it when the overlay opened if it is still in the page, else a cell's row or the page.
import type { Overlay } from "../store/overlay.js";

/** What floating-ui positions against: an element, or a zero-sized box at a point. */
export type Reference = Element | { readonly getBoundingClientRect: () => DOMRect };

const inCell = (cell: string, part: string) =>
  document.querySelector(`[data-cell="${CSS.escape(cell)}"] ${part}`);

const rowOf = (cell: string) => document.querySelector(`[data-cell="${CSS.escape(cell)}"]`);

/** The reference of a menu overlay, or undefined when its control is not in the page. */
export function referenceOf(overlay: Overlay): Reference | undefined {
  switch (overlay.kind) {
    case "cellMenu": {
      const { at } = overlay;
      if (at !== null) return { getBoundingClientRect: () => new DOMRect(at.x, at.y, 0, 0) };
      return inCell(overlay.cell, '[data-part="more"]') ?? rowOf(overlay.cell) ?? undefined;
    }
    case "typeMenu":
      return inCell(overlay.cell, '[data-testid="type-chip"]') ?? rowOf(overlay.cell) ?? undefined;
    case "restartMenu":
      return document.querySelector(`[data-anchor="restart-${overlay.from}"]`) ?? undefined;
    default:
      return undefined;
  }
}

/** The element the focus returns to once `overlay` closes: `opener` while it is in the page, else the overlay's cell's
 * row, else the selected cell's (`selected`), else the page itself, never <body>. */
export function focusBack(
  overlay: Overlay,
  opener: Element | null,
  selected: string | null,
): HTMLElement | null {
  if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body)
    return opener;
  for (const cell of ["cell" in overlay ? overlay.cell : null, selected]) {
    const row = cell === null ? null : rowOf(cell);
    if (row instanceof HTMLElement) return row;
  }
  const page = document.getElementById("page");
  return page instanceof HTMLElement ? page : null;
}
