// A command on the selected cell: it cannot run with none selected, and it writes unless it only shows
// something. The cell commands (cells.ts) and the clipboard's (clipboard.ts) are built with it.
import type { Cell } from "@jsnb/core";

import type { useNotebookStore } from "../store/notebook.js";
import type { Args, Command } from "./command.js";
import { keymapTitles } from "./labels.js";

/** What a command does with the selected cell. */
export type OnCell = (cell: Cell, args?: Args) => unknown;

/** A command `id` that runs `run` on the selected cell; `writes` unless it only shows something. */
export const onSelected =
  (store: ReturnType<typeof useNotebookStore>, writes = true) =>
  (id: string, title: string, run: OnCell): Command => ({
    id,
    // the one name the menus, the palette and the Keyboard Shortcuts editor share (labels.ts)
    title: keymapTitles[id] ?? title,
    source: "ui",
    writes,
    when: () => store.selectedCell !== undefined,
    run: (args) => {
      const cell = store.selectedCell;
      return cell === undefined ? undefined : run(cell, args);
    },
  });
