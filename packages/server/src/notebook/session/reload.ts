// notebook.reload: the file is read again and reconciled by cell id: a cell with
// the same id keeps its status and outputs, a new cell starts idle, a removed one disappears, the kernel is untouched.
// Subscribers see it as the events of those changes (deleted, updated, added, moved), then notebook.saved.
import type { CellId, StaleMap } from "@jsnb/core";
import { afterDelete, afterEdit, NotebookNotFound } from "@jsnb/core";

import { identityOf } from "../../files/atomicWrite.js";
import { readNotebook } from "../../files/notebooks/notebookFile.js";
import type { SessionContext } from "./context.js";
import { loadDocument } from "./fileForm.js";
import { restale } from "./edits.js";
import { disposeUnclient, disposeUnserved } from "./runs/disposeDeleted.js";
import type { CellRecord } from "./records.js";

const sameCell = (a: CellRecord, b: CellRecord): boolean =>
  a.type === b.type &&
  a.source === b.source &&
  JSON.stringify(a.meta) === JSON.stringify(b.meta) &&
  JSON.stringify(a.extra) === JSON.stringify(b.extra);

export type Plan = {
  readonly next: readonly CellRecord[];
  readonly removed: readonly CellId[];
  readonly changed: readonly CellId[];
  readonly added: readonly CellId[];
};

/** The reconciled cells: the file's, each keeping the status and runs of the cell it replaces. */
function plan(current: readonly CellRecord[], fromFile: readonly CellRecord[]): CellRecord[] {
  const byId = new Map(current.map((record) => [record.id, record]));
  return fromFile.map((record): CellRecord => {
    const old = byId.get(record.id);
    if (!old) return record;
    // a cell this session ran keeps its runs; one it never ran shows the file's saved run
    return {
      ...record,
      status: old.status,
      last: old.last ?? record.last,
      previous: old.last ? old.previous : undefined,
      ran: old.ran,
    };
  });
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
const cellsOf = (context: SessionContext, type: "server" | "client"): readonly CellId[] =>
  context.cells
    .list()
    .filter((record) => record.type === type)
    .map((record) => record.id);

/** Read before the reload, run after it: a server cell the file removed or switched has its routes and timers end in
 * the kernel, a client cell its timers and listeners end in the page. */
function leftBehind(context: SessionContext): () => void {
  const served = cellsOf(context, "server");
  const clients = cellsOf(context, "client");
  return () => {
    for (const id of served) void disposeUnserved(context, id);
    for (const id of clients) void disposeUnclient(context, id);
  };
}

/** The stale cells after the reconcile: what depended on a removed, changed or added cell. */
function restaleAfter(
  context: SessionContext,
  before: ReturnType<SessionContext["cells"]["graph"]>,
  done: Plan,
): void {
  let stale: StaleMap = context.cells.stale();
  for (const id of done.removed) stale = afterDelete(before, stale, id);
  for (const id of [...done.changed, ...done.added])
    stale = afterEdit(context.cells.graph(), stale, id);
  restale(context, stale);
}

/** Puts `next` in place of the session's cells: the events, the stale flags, the realms' disposals; `removing` hears
 * each cell that goes before it does. */
export function applyRecords(
  context: SessionContext,
  next: readonly CellRecord[],
  removing: (cell: CellId) => void = () => undefined,
): Plan {
  const current = context.cells.list();
  const byId = new Map(current.map((record) => [record.id, record]));
  const ids = new Set(next.map((record) => record.id));
  const done: Plan = {
    next,
    removed: current.filter((record) => !ids.has(record.id)).map((record) => record.id),
    changed: next.flatMap((record) => {
      const old = byId.get(record.id);
      return old !== undefined && !sameCell(old, record) ? [record.id] : [];
    }),
    added: next.filter((record) => !byId.has(record.id)).map((record) => record.id),
  };
  const before = context.cells.graph();
  const kept = context.cells.order().filter((id) => !done.removed.includes(id));
  const left = leftBehind(context);
  for (const id of done.removed) {
    removing(id);
    const last = context.cells.get(id)?.last;
    if (last) context.runs.retained.drop(last.id); // a removed cell's run goes with it
  }
  context.cells.replaceAll(done.next);
  emitChanges(context, done, kept);
  restaleAfter(context, before, done);
  for (const id of done.changed) context.hooks.edited(id, before);
  left();
  return done;
}

/** Re-reads the file and reconciles; NOTEBOOK_NOT_FOUND when the file is gone. */
export async function reloadSession(context: SessionContext): Promise<void> {
  const read = await readNotebook(context.path);
  if (read.kind === "missing") throw new NotebookNotFound({ path: context.ref });
  context.identity = (await identityOf(context.path)) ?? context.identity; // editors and git replace the inode
  const loaded = loadDocument(read.text, context.ref, context.ids);
  for (const warning of loaded.warnings) context.log.warn({ notebook: context.ref }, warning);
  context.header = loaded.header;
  applyRecords(context, plan(context.cells.list(), loaded.records));
  context.autosave.reloaded(read.text, loaded.dirty);
}
