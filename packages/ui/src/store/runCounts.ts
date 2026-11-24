// The execution count, as Jupyter's `[n]`: the kernel numbers each run as it starts (Execution.count),
// from 1 after every kernel start; a cell never run in this kernel, cleared, or showing saved outputs has none.
import type { CellId } from "@jsnb/core";
import { defineStore } from "pinia";

import { useNotebookStore } from "./notebook.js";

export const useRunCountStore = defineStore("runCounts", () => {
  const notebook = useNotebookStore();
  /** The run the page follows first (its events carry the count), else the cell's summary. */
  const countOf = (cell: CellId): number | null =>
    notebook.lastExecutionOf(cell)?.count ?? notebook.byId.get(cell)?.lastExecution?.count ?? null;
  return { countOf };
});
