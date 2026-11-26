// notebook.clearOutputs: the cells' last runs forgotten, as Jupyter's Clear All Outputs: no outputs, no
// execution count, the status idle; the kernel's state stays. A cell running or queued keeps its run.
import type { CellId } from "@jsnb/core";

import type { SessionContext } from "../context.js";

/** Clears `cells` (every cell when absent); answers the cells it cleared. */
export function clearOutputs(context: SessionContext, cells?: readonly CellId[]): CellId[] {
  const records =
    cells === undefined ? context.cells.list() : cells.map((cell) => context.cells.require(cell));
  const cleared: CellId[] = [];
  for (const record of records) {
    if (record.status === "running" || record.status === "queued") continue;
    if (record.last === undefined && record.previous === undefined) continue;
    if (record.last) context.runs.retained.drop(record.last.id);
    record.last = undefined;
    record.previous = undefined;
    record.status = "idle";
    cleared.push(record.id);
    context.emit("cell.updated", { cell: context.cells.api(record) });
  }
  if (cleared.length > 0) context.autosave.touched();
  return cleared;
}
