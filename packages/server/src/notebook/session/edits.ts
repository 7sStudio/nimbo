// The cell edits of 03-api §4.3 on a session: add (an explicit id must be unused), update (source, type, meta merged;
// `meta.lastEdit` stamped from the connection when the code changed; a null key removed), revert and mark
// reviewed (an agent's edits no one reviewed yet), move and delete; each emits its event, recomputes the stale flags
// (cells.stale when they changed, 02-architecture §5 step 2) and schedules the autosave.
import type { CellId, CellType, StaleMap } from "@jsnb/core";
import { afterDelete, afterEdit, FileCellMeta } from "@jsnb/core";

import { analysisOf } from "./analysis.js";
import type { SessionContext } from "./context.js";
import type { Editor } from "./provenance.js";
import { reviewed, stamped } from "./provenance.js";
import type { CellRecord } from "./records.js";
import { disposeUnserved } from "./runs/disposeDeleted.js";

/** As cell.add's parsed input carries it (an absent key may be undefined). */
export type AddCell = {
  readonly type: CellType;
  readonly source: string;
  readonly after?: CellId | null | undefined;
  readonly id?: CellId | undefined;
};

/** As cell.update's parsed input carries it. */
export type UpdateCell = {
  readonly cell: CellId;
  readonly source?: string | undefined;
  /** The textHash of the source the edit was made on (07 §5). */
  readonly base?: string | undefined;
  readonly type?: CellType | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
};

/** Sets the stale flags and emits cells.stale (the whole list) when the set changed. */
export function restale(context: SessionContext, next: StaleMap): void {
  if (context.cells.setStale(next))
    context.emit("cells.stale", { cells: context.cells.staleCells() });
}

/** A cell id the notebook does not use yet. */
function freshId(context: SessionContext): CellId {
  let id = context.ids.cell();
  while (context.cells.get(id)) id = context.ids.cell();
  return id;
}

export function addCell(context: SessionContext, input: AddCell, editor: Editor): CellRecord {
  const record: CellRecord = {
    id: input.id ?? freshId(context),
    type: input.type,
    source: input.source,
    // a new cell's code was empty before: an agent's cell waits for review like any of its edits
    meta: {
      lastEdit: stamped(undefined, editor, context.now().toISOString(), {
        before: { source: "", type: input.type },
        after: input,
      }),
    },
    extra: {},
    analysis: analysisOf(input.type, input.source),
    status: "idle",
    last: undefined,
  };
  context.cells.insert(record, input.after);
  context.emit("cell.added", { cell: context.cells.api(record) });
  restale(context, afterEdit(context.cells.graph(), context.cells.stale(), record.id));
  context.autosave.touched();
  return record;
}

/** The cell's meta with the update merged in: a key sent as `null` is removed; the result is parsed
 * again so the record keeps the API's shape. */
function mergedMeta(current: CellRecord["meta"], update: UpdateCell["meta"]): CellRecord["meta"] {
  const merged = { ...current, ...update };
  const kept = Object.entries(merged).filter(([, value]) => value !== null);
  return FileCellMeta.parse(Object.fromEntries(kept));
}

export function updateCell(context: SessionContext, input: UpdateCell, editor: Editor): CellRecord {
  const record = context.cells.require(input.cell);
  const before = context.cells.graph();
  const code =
    (input.source !== undefined && input.source !== record.source) ||
    (input.type !== undefined && input.type !== record.type);
  const was = { source: record.source, type: record.type };
  record.source = input.source ?? record.source;
  record.type = input.type ?? record.type;
  record.meta = mergedMeta(record.meta, input.meta);
  // the stamp says who last changed the code: a preference (collapse, a pinned query) leaves it alone
  if (code) {
    const at = context.now().toISOString();
    const lastEdit = stamped(record.meta.lastEdit, editor, at, { before: was, after: record });
    record.meta = { ...record.meta, lastEdit };
  }
  if (code) record.analysis = analysisOf(record.type, record.source);
  context.emit("cell.updated", { cell: context.cells.api(record) });
  // a server cell switched to client or markdown: its routes and timers end in the kernel (no-op for a server cell)
  if (was.type === "server") void disposeUnserved(context, record.id);
  if (code) {
    const old = afterEdit(before, context.cells.stale(), record.id);
    restale(context, afterEdit(context.cells.graph(), old, record.id));
    context.hooks.edited(record.id, before);
  }
  context.autosave.touched();
  return record;
}

/** cell.revert: the code from before the agent edits no one reviewed is put back as an edit by `editor` (stamped as any
 * edit, dependents stale); a cell with none is left as it is. */
export function revertCell(context: SessionContext, cell: CellId, editor: Editor): CellRecord {
  const record = context.cells.require(cell);
  const review = record.meta.lastEdit?.review;
  if (review === undefined) return record;
  const { previousSource: source, previousType: type } = review;
  return updateCell(context, { cell, source, type }, editor);
}

/** cell.markReviewed: the code stays and its stamp loses the review; a cell with none is left as it is. */
export function markReviewed(context: SessionContext, cell: CellId): CellRecord {
  const record = context.cells.require(cell);
  const edit = record.meta.lastEdit;
  if (edit?.review === undefined) return record;
  record.meta = { ...record.meta, lastEdit: reviewed(edit) };
  context.emit("cell.updated", { cell: context.cells.api(record) });
  context.autosave.touched();
  return record;
}

export function moveCell(
  context: SessionContext,
  cell: CellId,
  after: CellId | null,
): readonly CellId[] {
  context.cells.move(cell, after);
  const order = context.cells.order();
  context.emit("cell.moved", { order: [...order] });
  context.autosave.touched();
  return order;
}

export function deleteCell(context: SessionContext, cell: CellId): void {
  const before = context.cells.graph();
  context.hooks.deleting(cell);
  context.cells.remove(cell);
  context.emit("cell.deleted", { cell });
  restale(context, afterDelete(before, context.cells.stale(), cell));
  context.autosave.touched();
}
