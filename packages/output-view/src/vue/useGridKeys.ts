// The grid's keyboard and selection: ↑ ↓ Home End move the active row, ↩ opens it as a tree,
// Space or ⌘-click selects rows for "export selection", ⌘C copies the row.
import type { Ref } from "vue";
import { ref } from "vue";

import type { GridRow } from "../model/records.js";

export type GridActions = {
  readonly open: (row: GridRow) => void;
  readonly copy: (row: GridRow) => void;
  readonly scrollTo: (index: number) => void;
};

const moves: Readonly<Partial<Record<string, (count: number, at: number) => number>>> = {
  ArrowDown: (count, at) => Math.min(count - 1, at + 1),
  ArrowUp: (_count, at) => Math.max(0, at - 1),
  Home: () => 0,
  End: (count) => count - 1,
};

export function useGridKeys(
  rows: Readonly<Ref<readonly GridRow[]>>,
  selection: Ref<readonly number[]>,
  actions: GridActions,
) {
  const active = ref(0);
  const toggle = (row: GridRow): void => {
    const has = selection.value.includes(row.index);
    selection.value = has
      ? selection.value.filter((index) => index !== row.index)
      : [...selection.value, row.index];
  };

  function onKeydown(event: KeyboardEvent): void {
    const move = moves[event.key];
    const row = rows.value[active.value];
    if (move) {
      active.value = Math.max(0, move(rows.value.length, active.value));
      actions.scrollTo(active.value);
    } else if (row && event.key === "Enter") actions.open(row);
    else if (row && event.key === " ") toggle(row);
    else if (row && event.key.toLowerCase() === "c" && (event.metaKey || event.ctrlKey))
      actions.copy(row);
    else return;
    event.preventDefault();
  }

  /** A click opens the row as a tree; with ⌘, Ctrl or ⇧ it selects the row instead. */
  function onClick(event: MouseEvent, position: number, row: GridRow): void {
    active.value = position;
    if (event.metaKey || event.ctrlKey || event.shiftKey) toggle(row);
    else actions.open(row);
  }

  return { active, onKeydown, onClick };
}
