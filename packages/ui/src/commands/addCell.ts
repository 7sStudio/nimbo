// Adding a cell from the keyboard, the menus and the palette: A and B, Shift S, Shift C and Shift M. Each
// opens the new cell in edit mode with the caret inside, ready to type, as the add buttons do (the owner, 2026-11-15: a
// new cell never waits for a double-click).
import type { Cell, CellId, CellType } from "@jsnb/core";

import type { useNotebookStore } from "../store/notebook.js";
import { blockEnd } from "../store/sections.js";
import type { useUiStore } from "../store/ui.js";
import type { Args, Command } from "./command.js";
import { stringArg } from "./command.js";

type Store = ReturnType<typeof useNotebookStore>;
type Ui = ReturnType<typeof useUiStore>;

/** The cell's position by id: a cell object goes stale as soon as an event replaces it. */
export const positionOf = (order: readonly Cell[], cell: Cell) =>
  order.findIndex((each) => each.id === cell.id);

export const typeOf = (args: Args | undefined): CellType | undefined => {
  const type = stringArg(args, "type");
  return type === "server" || type === "client" || type === "markdown" ? type : undefined;
};

/** The cell the new one goes after: next to the selected one, or at the end with none selected (null: at the top).
 * Below a collapsed heading it goes after its section; above a cell, after the block the page shows before it. */
function afterOf(store: Store, cell: Cell | undefined, above: boolean): CellId | null {
  const order = store.cellsInOrder;
  if (cell === undefined) return order.at(-1)?.id ?? null;
  const shown = store.visibleInOrder;
  const before = above ? shown[positionOf(shown, cell) - 1]?.id : cell.id;
  return before === undefined ? null : blockEnd(order, store.sections, before);
}

/** A cell of the selected one's type (or `type`) above or below it, opened in edit mode, the caret at its end. */
async function addNear(store: Store, ui: Ui, above: boolean, args: Args | undefined) {
  const cell = store.selectedCell;
  const type = typeOf(args) ?? cell?.type ?? "server";
  const added = await store.add(type, afterOf(store, cell, above));
  if (added === undefined) return;
  ui.select(added.id);
  ui.setMode("edit", "end");
}

/** ui.cell.addAbove and ui.cell.addBelow (`{ type }` for Shift S, Shift C, Shift M); they run with none selected too. */
export function addCommands(store: Store, ui: Ui): readonly Command[] {
  const add = (id: string, title: string, above: boolean): Command => ({
    id,
    title,
    source: "ui",
    writes: true,
    run: (args) => addNear(store, ui, above, args),
  });
  return [
    add("ui.cell.addAbove", "Add a cell above", true),
    add("ui.cell.addBelow", "Add a cell below", false),
  ];
}
