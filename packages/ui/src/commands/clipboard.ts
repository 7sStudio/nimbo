// C, X, V and ⇧V, as in Jupyter: the marked cells copied to the page's own clipboard, cut (a delete, so Z
// brings them back), pasted below or above the selected cell in their order, the last pasted selected.
import type { Cell } from "@jsnb/core";

import type { useNotebookStore } from "../store/notebook.js";
import type { useUiStore } from "../store/ui.js";
import { hasSendable, sendable } from "../store/undo.js";
import type { Command } from "./command.js";
import { stringArg } from "./command.js";
import { onSelected } from "./selected.js";

type Store = ReturnType<typeof useNotebookStore>;
type Ui = ReturnType<typeof useUiStore>;

/** The cell's position by id. */
const positionOf = (order: readonly Cell[], cell: Cell) =>
  order.findIndex((each) => each.id === cell.id);

/** Copies the marked cells (the editors' unsent text with them) and says how many; answers them. */
function copier(store: Store, ui: Ui) {
  return () => {
    const marked = store.markedCells;
    ui.clipboard = marked.map((cell) => ({
      type: cell.type,
      source: ui.draftOf(cell.id) ?? cell.source,
      meta: cell.meta,
    }));
    const count = marked.length === 1 ? "1 cell" : `${String(marked.length)} cells`;
    ui.toast({ kind: "success", title: `Copied ${count}` });
    return marked;
  };
}

/** Pastes the clipboard's cells below `cell` (or above it), in their order, each with its meta; the last selected. */
function paster(store: Store, ui: Ui) {
  return async (cell: Cell, above: boolean) => {
    const order = store.cellsInOrder;
    let after = above ? (order[positionOf(order, cell) - 1]?.id ?? null) : cell.id;
    for (const each of ui.clipboard) {
      const added = await store.add(each.type, after, each.source);
      if (added === undefined) return;
      if (hasSendable(each.meta)) await store.update(added.id, { meta: sendable(each.meta) });
      after = added.id;
      ui.select(added.id);
    }
  };
}

export function clipboardCommands(store: Store, ui: Ui): readonly Command[] {
  const copy = copier(store, ui);
  const paste = paster(store, ui);
  let cutting = false;
  return [
    onSelected(store, false)("ui.cells.copy", "Copy the cells", copy),
    onSelected(store)("ui.cells.cut", "Cut the cells", async () => {
      // one cut at a time: a second X while the first is out would delete the same cells again
      if (cutting) return undefined;
      cutting = true;
      try {
        const ids = copy().map((cell) => cell.id);
        return await store.removeAll(store.cellsInOrder, ids);
      } finally {
        cutting = false;
      }
    }),
    {
      ...onSelected(store)("ui.cells.paste", "Paste the cells", (cell, args) =>
        paste(cell, stringArg(args, "where") === "above"),
      ),
      when: () => store.selectedCell !== undefined && ui.clipboard.length > 0,
    },
  ];
}
