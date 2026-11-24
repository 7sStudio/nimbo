// The cell title's commands: the header's title field sends them (cells/CellName.vue).
import type { useNotebookStore } from "../store/notebook.js";
import type { useUiStore } from "../store/ui.js";
import type { Command } from "./command.js";
import { stringArg } from "./command.js";

type Store = ReturnType<typeof useNotebookStore>;
type Ui = ReturnType<typeof useUiStore>;

/** The header's title field: Enter or a blur saves its text as meta.title, an empty one removes it (the
 * derived name comes back), Esc leaves it. Only the field gives the title, so the palette never offers either. */
export function titleCommands(store: Store, ui: Ui): readonly Command[] {
  return [
    {
      id: "ui.cell.setTitle",
      title: "Set Cell Title",
      source: "ui",
      writes: true,
      when: (args) => store.selectedCell !== undefined && stringArg(args, "title") !== undefined,
      run: (args) => {
        ui.setRenaming(null);
        const cell = store.selectedCell;
        const title = (stringArg(args, "title") ?? "").trim().slice(0, 200);
        if (cell === undefined || title === (cell.meta.title ?? "")) return undefined;
        return store.update(cell.id, { meta: { title: title === "" ? null : title } });
      },
    },
    {
      id: "ui.cell.cancelRename",
      title: "Cancel Rename",
      source: "ui",
      when: () => ui.renaming !== null,
      run: () => {
        ui.setRenaming(null);
      },
    },
  ];
}
