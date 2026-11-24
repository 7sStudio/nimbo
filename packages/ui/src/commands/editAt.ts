// The Search view's jump as a page command: `ui.edit.at` selects a cell, opens it if Fold All folded it,
// and edits it with the caret on a match.
import type { useNotebookStore } from "../store/notebook.js";
import type { useUiStore } from "../store/ui.js";
import type { Args, Command } from "./command.js";
import { stringArg, uiCommand as ui } from "./command.js";

/** A number argument, or undefined. */
const numberArg = (args: Args | undefined, key: string): number | undefined => {
  const value = args?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

/** The Search view's jump: the cell selected, opened if Fold All folded it, edited with the caret on the match. */
export function editAt(
  store: ReturnType<typeof useUiStore>,
  notebook: ReturnType<typeof useNotebookStore>,
): Command {
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
