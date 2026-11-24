// The values views' data: for each cell whose values view is open, cell.bindings once when it opens and
// again after each of its runs (a new last execution), kept per cell until the view closes. null: on its way.
import type { BindingValue, CellId } from "@jsnb/core";
import { shallowRef, watch } from "vue";

import type { useNotebookStore } from "../store/notebook.js";

type Values = ReadonlyMap<CellId, readonly BindingValue[] | null>;

export function useValues(store: ReturnType<typeof useNotebookStore>) {
  const values = shallowRef<Values>(new Map());
  const asked = new Map<CellId, string>();

  async function read(cell: CellId, run: string): Promise<void> {
    asked.set(cell, run);
    if (!values.value.has(cell)) values.value = new Map(values.value).set(cell, null);
    const answer = await store.bindings(cell);
    // an answer for a run that is no longer the last one, or for a view closed since, is dropped
    if (asked.get(cell) !== run) return;
    values.value = new Map(values.value).set(cell, answer?.bindings ?? []);
  }

  // Side effect: an open values view reads the cell's bindings when it opens and after each finished run.
  watch(
    () =>
      store.cellsInOrder
        .filter((cell) => cell.meta.showBindings === true && cell.type !== "markdown")
        .map((cell) => [cell.id, `${cell.lastExecution?.id ?? ""}:${cell.status}`] as const),
    (open) => {
      const ids = new Set(open.map(([id]) => id));
      for (const id of [...asked.keys()]) if (!ids.has(id)) asked.delete(id);
      if ([...values.value.keys()].some((id) => !ids.has(id)))
        values.value = new Map([...values.value].filter(([id]) => ids.has(id)));
      for (const [id, run] of open) {
        const settled = !run.endsWith(":running") && !run.endsWith(":queued");
        if (settled && asked.get(id) !== run) void read(id, run);
      }
    },
    { immediate: true },
  );
  return values;
}
