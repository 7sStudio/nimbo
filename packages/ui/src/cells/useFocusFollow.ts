// The selected cell holds the list's one tab stop and, when the keyboard or a command selected it, the focus and the
// scroll; a pointer's selection leaves both to the click (a click in a query input keeps its focus, and the page never
// scrolls under the pointer between its press and its release). The item's own focus ring is its card's, since the
// item also holds the add gap above the card.
import type { CellId, CellType } from "@jsnb/core";
import type { Ref } from "vue";
import { nextTick, watch } from "vue";

import type { useNotebookStore } from "../store/notebook.js";
import type { useUiStore } from "../store/ui.js";
import { itemOf, useReveal } from "./useReveal.js";

export function useFocusFollow(
  store: ReturnType<typeof useNotebookStore>,
  ui: ReturnType<typeof useUiStore>,
  list: Readonly<Ref<HTMLElement | null>>,
) {
  /** A pointer selected the cell: said once, to the next follow. */
  let pointer = false;
  const scroll = useReveal(ui, list);

  // Reveals and focuses the selected cell once it is in the list (one just added arrives with its event); a select of
  // the cell already selected (the outline, a Jump) reveals it again.
  watch(
    () =>
      [
        ui.selected !== null && store.byId.has(ui.selected) ? ui.selected : null,
        ui.selects,
      ] as const,
    async ([cell]) => {
      if (cell === null) return;
      await nextTick();
      const item = itemOf(cell);
      if (item === null) return;
      const active = document.activeElement;
      if (pointer) {
        pointer = false;
        scroll.release();
        return;
      }
      scroll.show(cell, item);
      const inList =
        active === null || active === document.body || active.closest("[data-cell]") !== null;
      if (ui.mode === "command" && inList) item.focus({ preventScroll: true });
    },
  );

  return {
    /** A press on a cell selects it without moving the focus or the page. */
    point: (cell: CellId) => {
      if (ui.selected === cell) return;
      pointer = true;
      ui.select(cell);
    },
    /** A markdown block opens its card with the caret at the end of its text. */
    edit: (cell: CellId) => {
      ui.select(cell);
      ui.setMode("edit", "end");
    },
    /** Adds a cell from an add button and opens its editor once it arrives, as VS Code's + Code and + Markdown do. */
    add: (type: CellType, after: CellId | null | undefined) => {
      void store.add(type, after).then((added) => {
        if (added === undefined) return;
        ui.select(added.id);
        ui.setMode("edit", "end");
      });
    },
  };
}
