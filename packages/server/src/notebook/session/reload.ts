// notebook.reload of 03-api §4.2 and 07-file-format §5: the file is read again and reconciled by cell id: a cell with
// the same id keeps its status and outputs, a new cell starts idle, a removed one disappears, the kernel is untouched.
// Subscribers see it as the events of those changes (deleted, updated, added, moved), then notebook.saved.
import type { CellId, StaleMap } from "@jsnb/core";
import { afterDelete, afterEdit, NotebookNotFound } from "@jsnb/core";

import { readNotebook } from "../../files/notebooks/notebookFile.js";
import type { SessionContext } from "./context.js";
import { loadDocument } from "./fileForm.js";
import { restale } from "./edits.js";
import { disposeUnserved } from "./runs/disposeDeleted.js";
import type { CellRecord } from "./records.js";

const sameCell = (a: CellRecord, b: CellRecord): boolean =>
  a.type === b.type &&
  a.source === b.source &&
  JSON.stringify(a.meta) === JSON.stringify(b.meta) &&
  JSON.stringify(a.extra) === JSON.stringify(b.extra);

type Plan = {
  readonly next: readonly CellRecord[];
  readonly removed: readonly CellId[];
  readonly changed: readonly CellId[];
  readonly added: readonly CellId[];
};

/** The reconciled cells: the file's, each keeping the status and runs of the cell it replaces. */
function plan(current: readonly CellRecord[], fromFile: readonly CellRecord[]): Plan {
  const byId = new Map(current.map((record) => [record.id, record]));
  const ids = new Set(fromFile.map((record) => record.id));
  const changed: CellId[] = [];
  const added: CellId[] = [];
  const next = fromFile.map((record): CellRecord => {
    const old = byId.get(record.id);
    if (!old) {
      added.push(record.id);
      return record;
    }
    if (!sameCell(old, record)) changed.push(record.id);
    // a cell this session ran keeps its runs; one it never ran shows the file's saved run
    return {
      ...record,
      status: old.status,
      last: old.last ?? record.last,
      previous: old.last ? old.previous : undefined,
    };
  });
  const removed = current.filter((record) => !ids.has(record.id)).map((record) => record.id);
  return { next, removed, changed, added };
}

/** The events of the reconcile; cell.moved with the final order whenever cells were added or kept ones reordered. */
function emitChanges(context: SessionContext, done: Plan, keptBefore: readonly CellId[]): void {
  const { cells } = context;
  for (const cell of done.removed) context.emit("cell.deleted", { cell });
  for (const id of done.changed)
    context.emit("cell.updated", { cell: cells.api(cells.require(id)) });
  for (const id of done.added) context.emit("cell.added", { cell: cells.api(cells.require(id)) });
  const keptAfter = cells.order().filter((id) => keptBefore.includes(id));
  if (done.added.length > 0 || keptAfter.join(",") !== keptBefore.join(",")) {
    context.emit("cell.moved", { order: [...cells.order()] });
  }
}

/** The ids of the server cells now. */
const serverCells = (context: SessionContext): readonly CellId[] =>
  context.cells
    .list()
    .filter((record) => record.type === "server")
    .map((record) => record.id);

/** Re-reads the file and reconciles; NOTEBOOK_NOT_FOUND when the file is gone. */
export async function reloadSession(context: SessionContext): Promise<void> {
  const read = await readNotebook(context.path);
  if (read.kind === "missing") throw new NotebookNotFound({ path: context.ref });
  const loaded = loadDocument(read.text, context.ref, context.ids);
  for (const warning of loaded.warnings) context.log.warn({ notebook: context.ref }, warning);
  const before = context.cells.graph();
  const done = plan(context.cells.list(), loaded.records);
  const kept = context.cells.order().filter((id) => !done.removed.includes(id));
  const served = serverCells(context);
  for (const id of done.removed) {
    const last = context.cells.get(id)?.last;
    if (last) context.runs.retained.drop(last.id); // a removed cell's run goes with it
  }
  context.header = loaded.header;
  context.cells.replaceAll(done.next);
  emitChanges(context, done, kept);
  let stale: StaleMap = context.cells.stale();
  for (const id of done.removed) stale = afterDelete(before, stale, id);
  for (const id of [...done.changed, ...done.added])
    stale = afterEdit(context.cells.graph(), stale, id);
  restale(context, stale);
  // a server cell the file removed or made a client or markdown cell: its routes and timers end in the kernel
  for (const id of served) void disposeUnserved(context, id);
  context.autosave.reloaded(read.text, loaded.dirty);
}
