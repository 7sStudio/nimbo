// The cell-scoped UI commands and the cell menu (§9.1.5): run and advance, run and insert, run above,
// add above and below, type, values, collapse, hidden outputs, move, copy, cut and paste cells, copy the id, full screen
// and the output's find and query bar, on the selected cell (run, type, copy and cut on a marked range). Each sends its
// registry command through the store.
import type { Cell, CellType } from "@jsnb/core";

import { copyText } from "../store/clipboard.js";
import { typeInto } from "../store/typed.js";
import { useNotebookStore } from "../store/notebook.js";
import { useUiStore } from "../store/ui.js";
import { addCommands, positionOf, typeOf } from "./addCell.js";
import { clipboardCommands } from "./clipboard.js";
import { titleCommands } from "./titles.js";
import type { OnCell } from "./selected.js";
import { onSelected } from "./selected.js";
import { moveBlock, sectionCommands } from "./sections.js";
import type { Command } from "./command.js";
import { stringArg } from "./command.js";

type Store = ReturnType<typeof useNotebookStore>;
type Ui = ReturnType<typeof useUiStore>;

/** Runs a code cell with `source` (the editor's unsent text), or saves a markdown cell's and so renders it. */
const runOrSave = async (store: Store, cell: Cell, source: string | undefined) => {
  if (cell.type !== "markdown") await store.run(cell.id, source);
  else if (source !== undefined) await store.update(cell.id, { source });
};

/** Runs the marked code cells in one notebook.run; a marked markdown cell has nothing to run. */
const runMarked = async (store: Store, marked: readonly Cell[]) => {
  const cells = marked.filter((cell) => cell.type !== "markdown").map((cell) => cell.id);
  if (cells.length > 0) await store.runSelection({ cells });
};

/**
 * ⇧↩: the mode and the selection move before the run's round trip, so a second press while the first is out acts
 * on the next cell, not this one again, and nothing resets the mode after it (a user may be editing the next cell by
 * then). On the last cell it runs and stays there, in command mode: ⌥↩ is the key that adds a cell.
 * A marked range runs as one, and the cell after it is selected.
 */
function advance(store: Store, ui: Ui): OnCell {
  return async (cell, args) => {
    const marked = store.markedCells;
    const last = marked.at(-1) ?? cell;
    const next = store.visibleInOrder[positionOf(store.visibleInOrder, last) + 1];
    ui.setMode("command");
    if (next !== undefined) ui.select(next.id);
    else if (marked.length > 1) ui.select(last.id);
    if (marked.length > 1) await runMarked(store, marked);
    else await runOrSave(store, cell, stringArg(args, "source") ?? ui.draftOf(cell.id));
  };
}

/**
 * ⌥↩, as in Jupyter: runs the cell (or the marked range), then adds a cell of the same type below it (below the range's
 * last) and edits it. A repeat while that cell is on its way adds nothing more; a selection the user moved meanwhile
 * stays where they put it.
 */
function runAndInsert(store: Store, ui: Ui): OnCell {
  const adding = new Set<string>();
  return async (cell, args) => {
    const marked = store.markedCells;
    const last = marked.at(-1) ?? cell;
    if (adding.has(last.id)) return;
    adding.add(last.id);
    try {
      ui.setMode("command");
      if (marked.length > 1) await runMarked(store, marked);
      else await runOrSave(store, cell, stringArg(args, "source") ?? ui.draftOf(cell.id));
      const added = await store.add(last.type, last.id);
      if (added !== undefined && ui.selected === cell.id) {
        ui.select(added.id);
        ui.setMode("edit");
      }
    } finally {
      adding.delete(last.id);
    }
  };
}

function runCommands(store: Store, ui: Ui): readonly Command[] {
  const command = onSelected(store);
  /** Runs a code cell with the editor's unsent text; a markdown cell saves it and renders (leaves edit mode). */
  const runOrRender: OnCell = async (cell, args) => {
    const marked = store.markedCells;
    if (marked.length > 1) await runMarked(store, marked);
    else await runOrSave(store, cell, stringArg(args, "source") ?? ui.draftOf(cell.id));
    // the draft stays until the cell's source catches up with it (cells/useDrafts.ts), so the editor never shows the
    // old text in between
    ui.setMode("command");
  };
  return [
    command("ui.run.advance", "Run the cell and select the next", advance(store, ui)),
    command("ui.run.inPlace", "Run the cell", runOrRender),
    command("ui.run.insertBelow", "Run the cell and insert one below", runAndInsert(store, ui)),
    command("ui.run.withDependents", "Run the cell with its dependents", (cell) =>
      store.runSelection({ withDependents: cell.id }),
    ),
    command("ui.run.above", "Run every cell above", (cell) =>
      store.runSelection({ above: cell.id }),
    ),
    command("ui.run.below", "Run the cell and every cell below", (cell) => {
      const order = store.cellsInOrder;
      const cells = order
        .slice(positionOf(order, cell))
        .filter((each) => each.type !== "markdown")
        .map((each) => each.id);
      return cells.length === 0 ? undefined : store.runSelection({ cells });
    }),
    {
      id: "ui.kernel.restartRunAll",
      title: "Restart Kernel and Run All",
      source: "ui",
      writes: true,
      run: async () => {
        await store.restart();
        await store.runSelection("all");
      },
    },
  ];
}

/** A meta flag of the cell flipped: the values view, collapse, hidden outputs. */
const toggled = (cell: Cell, key: "showBindings" | "collapsed" | "outputsHidden") => ({
  meta: { [key]: cell.meta[key] !== true },
});

/** W and the header's arrow: the cell's own meta.collapsed; while Fold All's fold is on, a cell it folded opens and folds
 * back on the page alone (store/fold.ts), and one folded by its own meta opens for good. */
async function toggleFold(store: Store, ui: Ui, cell: Cell): Promise<unknown> {
  if (!ui.foldAll) return store.update(cell.id, toggled(cell, "collapsed"));
  const open = ui.opened.has(cell.id) && cell.meta.collapsed !== true;
  ui.setOpened(cell.id, !open);
  return !open && cell.meta.collapsed === true
    ? store.update(cell.id, { meta: { collapsed: false } })
    : undefined;
}

/** N, W and O: the values view, collapse and hidden outputs, each a flag of the cell's meta. */
function toggleCommands(store: Store, ui: Ui): readonly Command[] {
  const command = onSelected(store);
  return [
    command("ui.cell.toggleValues", "Toggle the values view", (cell) =>
      store.update(cell.id, toggled(cell, "showBindings")),
    ),
    command("ui.cell.toggleCollapse", "Fold or unfold the cell", (cell) =>
      toggleFold(store, ui, cell),
    ),
    command("ui.cell.toggleOutputs", "Hide or show the cell's outputs", (cell) =>
      store.update(cell.id, toggled(cell, "outputsHidden")),
    ),
    command("ui.cell.rename", "Rename Cell", (cell) => {
      ui.setRenaming(cell.id);
    }),
    ...titleCommands(store, ui),
  ];
}

function editCommands(store: Store, ui: Ui): readonly Command[] {
  const command = onSelected(store);
  /** M and T on a marked range change every cell of it; Y's choice (`from: markdown`) only its markdown cells. */
  const retype = async (type: CellType, onlyMarkdown: boolean) => {
    for (const each of store.markedCells) {
      const skipped = onlyMarkdown && each.type !== "markdown";
      if (each.type !== type && !skipped) await store.update(each.id, { type });
    }
  };
  return [
    ...addCommands(store, ui),
    command("ui.cell.type", "Change the cell's type", (_cell, args) => {
      const type = typeOf(args);
      return type === undefined ? undefined : retype(type, stringArg(args, "from") === "markdown");
    }),
    // Y, Jupyter's "to code": server and client cells are code already; the marked markdown ones ask once which realm
    command("ui.cell.toCode", "Change the cells to code", (cell) => {
      if (store.markedCells.some((each) => each.type === "markdown"))
        ui.overlay = { kind: "typeMenu", cell: cell.id, toCode: true };
    }),
    ...toggleCommands(store, ui),
    command("ui.cell.moveUp", "Move the cell up", (cell) => moveBlock(store, cell, -1)),
    command("ui.cell.moveDown", "Move the cell down", (cell) => moveBlock(store, cell, 1)),
    ...sectionCommands(store),
  ];
}

function outputCommands(store: Store, ui: Ui): readonly Command[] {
  const command = onSelected(store, false);
  return [
    command("ui.fullscreen.open", "Show the cell's first value full screen", (cell) => {
      const index =
        store.lastExecutionOf(cell.id)?.outputs.findIndex((output) => output.kind === "value") ??
        -1;
      if (index >= 0) ui.fullscreen = { cell: cell.id, index };
    }),
    command("ui.output.find", "Find in the cell's output", (cell) => {
      ui.outputRequest = { kind: "find", cell: cell.id, at: Date.now() };
    }),
    command("ui.output.query", "Open the output's query bar", (cell) => {
      ui.outputRequest = { kind: "query", cell: cell.id, at: Date.now() };
    }),
    command("ui.cell.copyId", "Copy the cell's id", (cell) => copyText(ui, cell.id, "the cell id")),
    // P: the result moves to the inspector's Pinned result group (which scrolls into view, the focus staying here)
    command("ui.cell.pin", "Pin the result to the inspector, or unpin it", (cell) => {
      ui.togglePin(cell.id);
    }),
    // the marked range, or the selected cell alone
    onSelected(store)("ui.cell.clearOutput", "Clear the cell's output", () =>
      store.clearOutputs(store.markedCells.map((each) => each.id)),
    ),
    command("ui.cell.compare", "Compare the cell's last run with the run before it", (cell) => {
      if (cell.type !== "markdown") ui.overlay = { kind: "runCompare", cell: cell.id };
    }),
  ];
}

/** The agent edit of the selected cell no one reviewed yet: Revert puts the code back through the cell's
 * editor when the page shows it, so its undo takes it back, else through cell.revert; the whole diff in a dialog. */
function reviewCommands(store: Store, ui: Ui): readonly Command[] {
  const pending = () => store.selectedCell?.meta.lastEdit?.review !== undefined;
  const revert = onSelected(store)(
    "ui.cell.revert",
    "Revert the agent's edit of the cell",
    (cell) => {
      const review = cell.meta.lastEdit?.review;
      if (review === undefined) return undefined;
      // typed into the editor, the revert is sent at once rather than after the pause: a deliberate edit, which the
      // editor's undo then takes back as another
      if (review.previousType === cell.type && typeInto(cell.id, review.previousSource))
        return ui.flushDrafts.run();
      return store.revert(cell.id);
    },
  );
  const diff = onSelected(store, false)(
    "ui.cell.agentDiff",
    "Show the whole diff of the agent's edit of the cell",
    (cell) => {
      ui.overlay = { kind: "agentDiff", cell: cell.id };
    },
  );
  return [
    { ...revert, when: pending },
    { ...diff, when: pending },
  ];
}

export function cellCommands(): readonly Command[] {
  const store = useNotebookStore();
  const ui = useUiStore();
  return [
    ...runCommands(store, ui),
    ...editCommands(store, ui),
    ...clipboardCommands(store, ui),
    ...outputCommands(store, ui),
    ...reviewCommands(store, ui),
  ];
}
