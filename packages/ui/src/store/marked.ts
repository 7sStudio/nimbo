// The cells a range of the selection marks (⇧↑ and ⇧↓ as in Jupyter): from its anchor to the selected cell,
// in notebook order. Run, delete, copy, cut and the type keys act on all of them; every other key on the selected one.
// And the cell that takes the selection when the selected one is deleted.
import type { Cell, CellId } from "@jsnb/core";

/** The marked cells in order: the selected one alone when there is no range (or its anchor is gone), none when no cell
 * is selected. */
export function markedOf(
  order: readonly Cell[],
  selected: CellId | null,
  anchor: CellId | null,
): readonly Cell[] {
  const head = order.findIndex((cell) => cell.id === selected);
  const at = order[head];
  if (at === undefined) return [];
  const tail = anchor === null ? -1 : order.findIndex((cell) => cell.id === anchor);
  if (tail < 0) return [at];
  return order.slice(Math.min(head, tail), Math.max(head, tail) + 1);
}

/** The cell to select once `gone` left the notebook: the nearest one above it that is still there, else the nearest
 * below ('s D D), else none. */
export function neighbourOf(
  before: readonly CellId[],
  now: ReadonlySet<CellId>,
  gone: CellId,
): CellId | null {
  const at = before.indexOf(gone);
  const above = before.slice(0, Math.max(at, 0)).findLast((id) => now.has(id));
  return above ?? before.slice(at + 1).find((id) => now.has(id)) ?? null;
}
