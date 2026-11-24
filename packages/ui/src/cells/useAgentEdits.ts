// "Cell n edited by <agent>": an agent's edit to the cell the user has selected reaches its editor
// as a change (the caret survives) and a toast says who made it; edits to other cells show their badge only.
import { watch } from "vue";

import type { useNotebookStore } from "../store/notebook.js";
import { overOf } from "./agentEdit.js";
import type { useUiStore } from "../store/ui.js";

export function useAgentEdits(
  store: ReturnType<typeof useNotebookStore>,
  ui: ReturnType<typeof useUiStore>,
): void {
  // Side effect: a toast when the selected cell's last edit changes to an agent's.
  watch(
    () => {
      const cell = store.selectedCell;
      return cell === undefined ? null : { id: cell.id, edit: cell.meta.lastEdit };
    },
    (now, before) => {
      if (now === null || now.id !== before?.id) return;
      const edit = now.edit;
      if (edit?.by !== "agent" || edit.at === before.edit?.at) return;
      const number = store.cellsInOrder.findIndex((cell) => cell.id === now.id) + 1;
      ui.toast({
        kind: "info",
        title: `Cell ${String(number)} edited by ${edit.agent ?? "an agent"} ${overOf(edit)}`,
      });
    },
  );
}
