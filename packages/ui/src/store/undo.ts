// The one client-side undo: the last ten deletes from this page, this session. Restoring adds the
// last delete's cells back (all of a range deleted at once, as Jupyter's Z does) under their old ids where they were
// (cell.add { id }, 03-api §4.3), then puts their meta back; lastEdit is the server's and is not sent.
import type { Cell, CellId, CellMeta } from "@jsnb/core";
import { defineStore } from "pinia";
import { ref } from "vue";

import { attempter, usePageReport } from "./attempt.js";
import { useSessionStore } from "./socket.js";
import { useUiStore } from "./ui.js";

/** One deleted cell: `after` is where it goes back, `batch` the delete it was part of. */
export type Deleted = {
  readonly cell: Cell;
  readonly after: CellId | null;
  readonly at: number;
  readonly batch: number;
};

/** The deletes kept for undo: ten, each whole however many cells it took (a range is one). */
const undoLimit = 10;

/** The entries of the last `count` batches of `stack`, so no delete is ever kept in part. */
function lastBatches(stack: readonly Deleted[], count: number): readonly Deleted[] {
  const batches = [...new Set(stack.map((each) => each.batch))].slice(-count);
  const kept = new Set(batches);
  return stack.filter((each) => kept.has(each.batch));
}

/** The meta a client may send back: everything but the server's lastEdit (an absent key stays absent in JSON). */
export const sendable = ({
  title,
  showBindings,
  collapsed,
  headingCollapsed,
  outputsHidden,
  outputView,
  outputQuery,
  outputHeight,
  outputColumns,
  manual,
}: CellMeta) => ({
  title,
  showBindings,
  collapsed,
  headingCollapsed,
  outputsHidden,
  outputView,
  outputQuery,
  outputHeight,
  outputColumns,
  manual,
});

/** True when `meta` has a key to send back. */
export const hasSendable = (meta: CellMeta): boolean =>
  Object.values(sendable(meta)).some((value) => value !== undefined);

export const useUndoStore = defineStore("undo", () => {
  const ui = useUiStore();
  const session = useSessionStore();
  const attempt = attempter(usePageReport());
  const stack = ref<readonly Deleted[]>([]);

  let batches = 0;
  /** The toast that offers each delete's undo, closed once its cells are back (Z, the menu or its own button). */
  const toastOf = new Map<number, number>();

  /** Adds one deleted cell back under its old id with its meta; false when the add failed. */
  async function restoreOne({ cell, after }: Deleted): Promise<boolean> {
    const { client, notebook } = session.session();
    const added = await attempt(() =>
      client.cell.add({ notebook, id: cell.id, type: cell.type, source: cell.source, after }),
    );
    if (added === undefined) return false;
    if (hasSendable(cell.meta))
      await attempt(() =>
        client.cell.update({ notebook, cell: cell.id, meta: sendable(cell.meta) }),
      );
    return true;
  }

  /** Keeps the cells of one delete for an undo, each with where it goes back (bottom-up, so each one's `after` is
   * still there when it is restored), and shows the toast that offers it. */
  function remember(deleted: readonly { readonly cell: Cell; readonly after: CellId | null }[]) {
    if (deleted.length === 0) return;
    batches += 1;
    const at = Date.now();
    const kept = deleted.map((each) => ({ ...each, at, batch: batches }));
    stack.value = lastBatches([...stack.value, ...kept], undoLimit);
    const title = deleted.length === 1 ? "Cell deleted" : `${String(deleted.length)} cells deleted`;
    toastOf.set(
      batches,
      ui.toast({ kind: "info", title, action: { label: "Undo", command: "undo.restore" } }),
    );
  }

  let restoring: Promise<CellId | undefined> | null = null;
  /** One undo at a time: a second Z while the first is on its way answers the same, never re-adds its cells. */
  function restore(): Promise<CellId | undefined> {
    restoring ??= restoreLast().finally(() => {
      restoring = null;
    });
    return restoring;
  }

  /** Adds the last delete's cells back; resolves the id of the one restored last (the top one), or undefined when there
   * is nothing to undo or the first add failed (a later failure keeps the rest for another undo). */
  async function restoreLast(): Promise<CellId | undefined> {
    const batch = stack.value.at(-1)?.batch;
    let restored: CellId | undefined;
    let last = stack.value.at(-1);
    while (last !== undefined && last.batch === batch && (await restoreOne(last))) {
      const done = last;
      stack.value = stack.value.filter((each) => each !== done);
      restored = done.cell.id;
      last = stack.value.at(-1);
    }
    if (restored !== undefined && batch !== undefined) {
      const toast = toastOf.get(batch);
      if (toast !== undefined) ui.dismiss(toast);
      toastOf.delete(batch);
    }
    return restored;
  }

  return { stack, remember, restore };
});
