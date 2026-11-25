// The page's own commands (the `ui.*` namespace, plus `undo.restore`): panels, selection, mode, theme,
// filter and the way to the Home page, with the overlays' from overlays.ts. They change what the page shows, never notebook state; cell-scoped ones
// are in cells.ts.
import { homePageUrl } from "../store/address.js";
import { inClientOf } from "../store/missing.js";
import { useNotebookStore } from "../store/notebook.js";
import type { Place } from "../store/layout.js";
import { placeOf } from "../store/layout.js";
import { useUiStore } from "../store/ui.js";
import { useUndoStore } from "../store/undo.js";
import { appCommands, askSettingsFirst } from "./app.js";
import type { Args, Command } from "./command.js";
import { stringArg, uiCommand as ui } from "./command.js";
import { consented } from "./consent.js";

import { overlayCommands } from "./overlays.js";

type Ui = ReturnType<typeof useUiStore>;

/** The place the `which` argument names: a view, a tab or a section, or a panel's older name. */
const placeArg = (args: Args | undefined): Place | undefined => placeOf(stringArg(args, "which"));

/** A number argument, or undefined. */
const numberArg = (args: Args | undefined, key: string): number | undefined => {
  const value = args?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

/** The Search view's jump: the cell selected, opened if Fold All folded it, edited with the caret on the match. */
function editAt(store: Ui, notebook: ReturnType<typeof useNotebookStore>): Command {
  return ui(
    "ui.edit.at",
    "Edit a cell at a line",
    (args) => {
      const cell = stringArg(args, "cell");
      if (cell === undefined || !notebook.byId.has(cell)) return;
      const [line = 1, from = 0, to = 0] = ["line", "from", "to"].map((key) =>
        numberArg(args, key),
      );
      store.select(cell);
      if (store.foldAll) store.setOpened(cell, true);
      store.setMode("edit", { line, from, to });
    },
    (args) => stringArg(args, "cell") !== undefined,
  );
}

/** The workbench's three regions: the side panel (⌘B), the inspector (⌘I) and the bottom panel (⌘J). `ui.panel.*`
 * take a place by name and act on the region that holds it; with no name they act on the side panel. */
function panelCommands(store: Ui): readonly Command[] {
  return [
    ui("ui.panel.toggle", "Show or hide the side panel", (args) => {
      const place = placeArg(args);
      if (place === undefined) store.setRegion("side");
      else store.togglePlace(place);
    }),
    ui("ui.panel.open", "Open a panel", (args) => {
      const place = placeArg(args);
      if (place === undefined) store.setRegion("side", true);
      else store.openPlace(place, stringArg(args, "name"));
    }),
    ui("ui.panel.close", "Hide a panel", (args) => {
      store.setRegion(placeArg(args)?.region ?? "side", false);
    }),
    ui("ui.inspector.toggle", "Show or hide the inspector", () => {
      store.setRegion("inspector");
    }),
    ui("ui.bottom.toggle", "Show or hide the bottom panel", () => {
      store.setRegion("bottom");
    }),
  ];
}

function selectionCommands(
  store: Ui,
  notebook: ReturnType<typeof useNotebookStore>,
): readonly Command[] {
  const step = (by: -1 | 1) => {
    const ids = notebook.visibleInOrder.map((cell) => cell.id);
    const at = store.selected === null ? -1 : ids.indexOf(store.selected);
    const next = ids[at === -1 ? (by === 1 ? 0 : ids.length - 1) : at + by];
    if (next !== undefined) store.select(next);
  };
  /** ⇧↑ and ⇧↓ (Jupyter's extend): the selection moves, the range's other end stays (store/marked.ts). */
  const extend = (by: -1 | 1) => {
    const ids = notebook.visibleInOrder.map((cell) => cell.id);
    const at = store.selected === null ? -1 : ids.indexOf(store.selected);
    const next = at === -1 ? undefined : ids[at + by];
    if (next !== undefined) store.extendTo(next);
  };
  return [
    ui("ui.select", "Select a cell", (args) => {
      const cell = stringArg(args, "cell");
      if (cell !== undefined && notebook.byId.has(cell)) store.select(cell);
    }),
    ui("ui.select.previous", "Select the previous cell", () => {
      step(-1);
    }),
    ui("ui.select.next", "Select the next cell", () => {
      step(1);
    }),
    ui("ui.select.extendPrevious", "Extend the selection up", () => {
      extend(-1);
    }),
    ui("ui.select.extendNext", "Extend the selection down", () => {
      extend(1);
    }),
    ...modeCommands(store, step, notebook),
  ];
}

/** True when the last run of `cell` failed DefinedInClient and this tab may write: ↩ switches it to client. */
function switches(notebook: ReturnType<typeof useNotebookStore>, cell: string): boolean {
  const error = notebook.lastExecutionOf(cell)?.error;
  const writable =
    notebook.connection === "live" &&
    notebook.attach.state === "attached" &&
    !notebook.mirror.closed;
  return inClientOf(error) !== null && writable;
}

/** ↩ on a server cell whose last run failed DefinedInClient switches it to client (05-bridge §7), when
 * this tab may write; on any other cell it edits. */
function enter(store: Ui, notebook: ReturnType<typeof useNotebookStore>): unknown {
  const cell = notebook.selectedCell;
  if (cell?.type === "server" && switches(notebook, cell.id))
    return notebook.update(cell.id, { type: "client" });
  // a cell Fold All folded opens to be edited (one folded by its own meta stays as W left it)
  if (cell !== undefined && store.foldAll) store.setOpened(cell.id, true);
  store.setMode("edit");
  return undefined;
}

function modeCommands(
  store: Ui,
  step: (by: -1 | 1) => void,
  notebook: ReturnType<typeof useNotebookStore>,
): readonly Command[] {
  const selected = () => store.selected !== null;
  return [
    ui("ui.mode.edit", "Edit the selected cell", () => enter(store, notebook), selected),
    ui("ui.mode.command", "Leave the editor", () => {
      store.setMode("command");
    }),
    ui(
      "ui.edit.previous",
      "Edit the previous cell, at its end",
      () => {
        step(-1);
        store.setMode("edit", "end");
      },
      selected,
    ),
    editAt(store, notebook),
    ui(
      "ui.edit.next",
      "Edit the next cell, at its start",
      () => {
        step(1);
        store.setMode("edit", "start");
      },
      selected,
    ),
  ];
}

/** Changes of the notebook that are not on disk: a save that failed or conflicts, or text typed and not sent yet. */
const unsaved = (
  notebook: ReturnType<typeof useNotebookStore>,
  store: ReturnType<typeof useUiStore>,
): boolean =>
  notebook.mirror.saveState === "failed" ||
  notebook.mirror.saveState === "conflict" ||
  notebook.cellsInOrder.some((cell) => store.draftOf(cell.id) !== undefined);

/** Going to Home asks first about unsaved Settings (JSON) text, then about notebook changes not on disk. */
function leaveAsks(args: Args | undefined, store: ReturnType<typeof useUiStore>): boolean {
  if (askSettingsFirst(store, "ui.home.open", args)) return true;
  if (consented(args) || !unsaved(useNotebookStore(), store)) return false;
  store.overlay = { kind: "confirmLeave" };
  return true;
}

/** The view-only banner's Take Over: this tab takes the live page from the tab that holds it. */
const takeOver = (): Command =>
  ui(
    "ui.realm.takeOver",
    "Take the live page over from the tab that holds it",
    () => useNotebookStore().takeOver(),
    () => useNotebookStore().attach.state === "viewOnly",
  );

export function uiCommands(): readonly Command[] {
  const store = useUiStore();
  const undo = useUndoStore();
  return [
    ...overlayCommands(),
    ...panelCommands(store),
    ...selectionCommands(store, useNotebookStore()),
    ...appCommands(),
    takeOver(),
    // drafts flush on pagehide (cells/useDrafts.ts); changes not on disk ask first (LeaveDialog, SettingsLeaveDialog)
    ui("ui.home.open", "Go to Home", (args) => {
      if (leaveAsks(args, store)) return;
      // File > New Notebook: Home opens with its name field asking for the new notebook's name
      location.assign(`${homePageUrl(location)}${args?.new === true ? "#new" : ""}`);
    }),
    ui(
      "ui.unpin",
      "Unpin the result, show it under its cell",
      () => {
        store.togglePin(null);
      },
      () => store.pinned !== null,
    ),
    ui("ui.cells.foldAll", "Fold every cell to its header, or unfold them all", () => {
      store.setFoldAll(!store.foldAll, store.selected);
    }),
    ui("ui.filter.agentEdits", "Show only the cells with an agent edit to review", () => {
      store.filter = store.filter === "agentEdits" ? "all" : "agentEdits";
    }),
    {
      ...ui(
        "undo.restore",
        "Undo the last delete",
        () => undo.restore(),
        () => undo.stack.length > 0,
      ),
      writes: true,
    },
  ];
}
