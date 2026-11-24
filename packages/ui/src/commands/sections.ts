// The heading sections' commands: collapse and expand one or all, and the moves that take a collapsed
// section along (store/sections.ts).
import type { Cell } from "@jsnb/core";

import type { useNotebookStore } from "../store/notebook.js";
import { blockStep, headingOf } from "../store/sections.js";
import type { Command } from "./command.js";
import { onSelected } from "./selected.js";

type Store = ReturnType<typeof useNotebookStore>;

/** ⌥↑ and ⌥↓ move the cell past the next cell the page shows; a collapsed heading takes its section along. */
export const moveBlock = (store: Store, cell: Cell, step: -1 | 1) =>
  store.movePlanned(store.cellsInOrder, (ids) =>
    blockStep(
      ids.flatMap((id) => store.byId.get(id) ?? []),
      cell.id,
      step,
    ),
  );

/** Collapses or expands heading sections (store/sections.ts): `cell`'s own when it is a heading, else the section that
 * holds it (Left, as JupyterLab's), each a write of the heading cell's meta.headingCollapsed. */
export function sectionCommands(store: Store): readonly Command[] {
  const command = onSelected(store);
  const set = (cell: Cell, collapsed: boolean | "toggle") => {
    const head = headingOf(store.cellsInOrder, store.sections, cell.id);
    const target = head === null ? undefined : store.byId.get(head);
    if (target === undefined) return undefined;
    const next = collapsed === "toggle" ? target.meta.headingCollapsed !== true : collapsed;
    if ((target.meta.headingCollapsed === true) === next) return undefined;
    return store.update(target.id, { meta: { headingCollapsed: next } });
  };
  /** Every heading at once; null when there is none to change. */
  const all = (collapsed: boolean) => async () => {
    for (const head of store.sections.heads.keys()) {
      const cell = store.byId.get(head);
      const size = store.sections.heads.get(head)?.size ?? 0;
      if (cell !== undefined && size > 0 && (cell.meta.headingCollapsed === true) !== collapsed)
        await store.update(head, { meta: { headingCollapsed: collapsed } });
    }
  };
  const any = () => store.sections.heads.size > 0;
  return [
    command("ui.section.toggle", "Collapse or expand the section", (cell) => set(cell, "toggle")),
    command("ui.section.collapse", "Collapse the section", (cell) => set(cell, true)),
    command("ui.section.expand", "Expand the section", (cell) => set(cell, false)),
    { ...command("ui.sections.collapseAll", "Collapse every section", all(true)), when: any },
    { ...command("ui.sections.expandAll", "Expand every section", all(false)), when: any },
  ];
}
