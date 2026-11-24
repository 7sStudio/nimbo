// "Updated from disk: 3 cells": a short toast when the daemon merged an edit made to the notebook's file outside
// nimbo (notebook.reconciled, 07-file-format §5); the cells themselves change in place and carry their review marks.
// A file that does not parse says so; a conflict has its banner instead. A cell changed on disk while its text is
// still a draft here keeps the typed text, which goes out as the user's edit, and the toast names it.
import { watch } from "vue";

import type { useNotebookStore } from "../store/notebook.js";
import type { useUiStore } from "../store/ui.js";

const cellsWord = (n: number) => `${String(n)} ${n === 1 ? "cell" : "cells"}`;

export function useExternalEdits(
  store: ReturnType<typeof useNotebookStore>,
  ui: ReturnType<typeof useUiStore>,
): void {
  // Side effect: one toast per reconcile the stream brings.
  watch(
    () => store.mirror.external,
    (now, before) => {
      if (now === null || now.seq === before?.seq) return;
      if (now.outcome === "unreadable") {
        ui.toast({
          kind: "error",
          title: "Not updated from disk",
          text: "The file does not parse.",
        });
        return;
      }
      if (now.outcome !== "merged") return;
      const touched = new Set([...now.changed, ...now.added, ...now.removed]);
      if (touched.size === 0) return;
      const typed = now.changed.filter((id) => {
        const draft = ui.draftOf(id);
        return draft !== undefined && draft !== store.byId.get(id)?.source;
      });
      const number = (id: string) => store.cellsInOrder.findIndex((cell) => cell.id === id) + 1;
      const text =
        typed.length > 0
          ? `Cell ${typed.map((id) => String(number(id))).join(", ")} kept your typing.`
          : now.kept
            ? "Merged with your unsaved edits."
            : undefined;
      ui.toast({
        kind: "info",
        title: `Updated from disk: ${cellsWord(touched.size)}`,
        ...(text === undefined ? {} : { text }),
      });
    },
  );
}
