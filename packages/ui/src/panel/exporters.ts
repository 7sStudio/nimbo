// The Variables panel's shadow line: which server cell's source exports a name, so a
// client name that shadows it can say the page's own is the one client cells read.
import type { CellId } from "@jsnb/core";

type ServerCell = { readonly id: CellId; readonly type: string };

/** Each name a server cell's source exports, with the 1-based number of the first such cell in notebook order. */
export function exportersOf(
  cells: readonly ServerCell[],
  exportsOf: (cell: CellId) => readonly string[] | undefined,
): ReadonlyMap<string, number> {
  const found = new Map<string, number>();
  cells.forEach((cell, at) => {
    if (cell.type !== "server") return;
    for (const name of exportsOf(cell.id) ?? []) if (!found.has(name)) found.set(name, at + 1);
  });
  return found;
}
