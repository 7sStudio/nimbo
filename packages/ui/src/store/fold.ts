// What the page shows of each cell beyond the notebook's own state, page-only and lost on a
// reload: Fold All's fold of the whole notebook, the cells opened while it is on, the result pinned to the inspector and
// where the caret of the edited cell is. Fold All never writes a cell's meta.collapsed: it is a way of reading the
// notebook as a list, so a view-only tab folds too and the file never changes for it.
import type { CellId, CellMeta } from "@jsnb/core";
import { ref } from "vue";

/** The caret of the edited cell, 1-based, for the status bar. */
export type CaretAt = { readonly cell: CellId; readonly line: number; readonly column: number };

/** True when `cell` shows its header row alone: folded by its own meta (W, the arrow), or by Fold All and not opened. */
export function isFolded(
  cell: { readonly id: CellId; readonly meta: CellMeta },
  all: boolean,
  opened: ReadonlySet<CellId>,
): boolean {
  return cell.meta.collapsed === true || (all && !opened.has(cell.id));
}

/** Fold All's fold and the cells opened under it. */
export function foldState() {
  const foldAll = ref(false);
  const opened = ref<ReadonlySet<CellId>>(new Set());
  return {
    foldAll,
    opened,
    /** Folds every cell (`keep`, the selected one, stays open as it was) or unfolds them all. */
    setFoldAll: (on: boolean, keep: CellId | null) => {
      foldAll.value = on;
      opened.value = on && keep !== null ? new Set([keep]) : new Set();
    },
    /** Opens or folds back one cell while Fold All's fold is on. */
    setOpened: (cell: CellId, open: boolean) => {
      const next = new Set(opened.value);
      if (open) next.add(cell);
      else next.delete(cell);
      opened.value = next;
    },
  };
}

/** The result pinned to the inspector (P), the edited cell's caret and the cell being renamed. */
export function pinState() {
  const pinned = ref<CellId | null>(null);
  const caretAt = ref<CaretAt | null>(null);
  /** The cell whose title is being edited in its header (double click on the name, F2), or null. */
  const renaming = ref<CellId | null>(null);
  return {
    pinned,
    caretAt,
    renaming,
    setRenaming: (cell: CellId | null) => {
      renaming.value = cell;
    },
    /** Pins `cell`'s result to the inspector, or unpins it when it is the pinned one; null unpins. */
    togglePin: (cell: CellId | null) => {
      pinned.value = cell === null || pinned.value === cell ? null : cell;
    },
    setCaretAt: (at: CaretAt | null) => {
      caretAt.value = at;
    },
  };
}
