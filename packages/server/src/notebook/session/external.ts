// External edits of an open notebook's file (07-file-format §5): the file another program changed is merged into the
// session by cell id against the text the daemon last wrote or read (core's mergeCells). The file's changes to cells
// the session left alone change them in place (stamped `client: "file"` for review, outputs and status kept where the
// code did not change, the kernel left alone); a cell both sides changed is held in conflict, with autosave
// suspended, until the user chooses or the file stops differing from it; the daemon writes only when the session's own
// unsaved edits stay on top. A page edit made on a text the file has replaced since (cell.update's `base`) holds its
// cell in conflict too, whatever the timing. A file that does not parse is read again once after a moment, then left
// out until it changes. Runs in the queue of the file's writes, so a write of the daemon is never taken for another
// program's.
import type { CellId, CellMerge, CellType, DocumentCell } from "@jsnb/core";
import { mergeCells, textHash } from "@jsnb/core";

import { identityOf } from "../../files/atomicWrite.js";
import { readNotebook } from "../../files/notebooks/notebookFile.js";
import { analysisOf } from "./analysis.js";
import type { SessionContext } from "./context.js";
import type { LoadedDocument } from "./fileForm.js";
import { loadDocument, savesOutputs } from "./fileForm.js";
import { stamped } from "./provenance.js";
import type { CellRecord } from "./records.js";
import type { Plan } from "./reload.js";
import { applyRecords } from "./reload.js";

type Code = { readonly source: string; readonly type: CellType };

/** What a session knows of the file's edits beyond its base text. */
export type ExternalState = {
  /** The cells whose text came from the file: that text's textHash and the code it replaced. */
  readonly fromDisk: Map<CellId, { readonly hash: string; readonly before: Code }>;
  /** The cells of the open conflict, each with the base it is merged against (null: a cell the base lacks). */
  readonly held: Map<CellId, DocumentCell | null>;
  /** Both sides reordered the same cells: the base stays as it was until the conflict ends. */
  order: boolean;
};

export const externalState = (): ExternalState => ({
  fromDisk: new Map(),
  held: new Map(),
  order: false,
});

export type ExternalOutcome = "same" | "resumed" | "merged" | "conflict" | "unreadable" | "missing";

const documentCell = ({ id, type, source, meta, extra }: CellRecord): DocumentCell => ({
  id,
  type,
  source,
  meta,
  extra,
});

/** The base's cells, each held cell as its conflict's base; nothing when there is no base text. */
function baseCells(
  context: SessionContext,
  state: ExternalState,
  text: string | undefined,
): readonly DocumentCell[] {
  let cells: readonly DocumentCell[] = [];
  try {
    if (text !== undefined)
      cells = loadDocument(text, context.ref, context.ids).records.map(documentCell);
  } catch {
    cells = []; // the daemon wrote or read that text, so it parses
  }
  return cells.flatMap((cell) => {
    if (!state.held.has(cell.id)) return [cell];
    const held = state.held.get(cell.id);
    return held === null || held === undefined ? [] : [held];
  });
}

/** The merged cells as records: a kept cell keeps its runs and status, a cell new from the file takes its saved run;
 * the cells whose code came from the file are stamped as an external edit, and noted in `fromDisk`. */
function recordsOf(
  context: SessionContext,
  state: ExternalState,
  merged: { readonly cells: readonly DocumentCell[]; readonly theirs: LoadedDocument },
  fromTheirs: ReadonlySet<string>,
): CellRecord[] {
  const at = context.now().toISOString();
  const file = new Map(merged.theirs.records.map((record) => [record.id, record]));
  return merged.cells.flatMap((cell): CellRecord[] => {
    const old = context.cells.get(cell.id);
    const before = old ?? { source: "", type: cell.type };
    let meta = cell.meta;
    if (fromTheirs.has(cell.id)) {
      const lastEdit = stamped(old?.meta.lastEdit, { client: "file" }, at, { before, after: cell });
      meta = { ...cell.meta, lastEdit };
      state.fromDisk.set(cell.id, {
        hash: textHash(cell.source),
        before: { source: before.source, type: before.type },
      });
    }
    if (old === undefined) {
      const added = file.get(cell.id);
      return added === undefined ? [] : [{ ...added, meta }];
    }
    const code = old.source !== cell.source || old.type !== cell.type;
    return [
      {
        ...old,
        type: cell.type,
        source: cell.source,
        meta,
        extra: cell.extra,
        analysis: code ? analysisOf(cell.type, cell.source) : old.analysis,
        last: old.last ?? file.get(cell.id)?.last,
      },
    ];
  });
}

const emptyLists = { changed: [], added: [], removed: [] };

/** The file is the base again with no cell held: a conflict a save found (merging off at the time) is over. */
function resume(context: SessionContext, text: string | undefined): ExternalOutcome {
  const { conflict, dirty } = context.autosave.state();
  if (!conflict || text === undefined) return "same";
  context.autosave.reloaded(text, dirty);
  return "resumed";
}

type Read = {
  readonly text: string;
  readonly hash: string;
  readonly theirs: LoadedDocument | Error;
};

function parsed(context: SessionContext, text: string): LoadedDocument | Error {
  try {
    return loadDocument(text, context.ref, context.ids);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

const settleMs = 250;

/** The file's text, parsed; one that does not parse is read again once after a moment (a write under way). */
async function readSettled(context: SessionContext): Promise<Read | undefined> {
  for (let attempt = 0; ; attempt += 1) {
    const read = await readNotebook(context.path);
    if (read.kind === "missing") return undefined;
    context.identity = (await identityOf(context.path)) ?? context.identity; // editors and git replace the inode
    const theirs = parsed(context, read.text);
    if (!(theirs instanceof Error) || attempt > 0) return { ...read, theirs };
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  }
}

function unreadable(context: SessionContext, error: Error): ExternalOutcome {
  context.log.info(
    { notebook: context.ref, err: error },
    "the notebook's file does not parse; kept",
  );
  context.emit("notebook.reconciled", {
    path: context.ref,
    outcome: "unreadable",
    ...emptyLists,
    kept: true,
    error: error.message,
  });
  return "unreadable";
}

/** The conflict stays or starts: the merged cells are taken, the conflicting ones held against their base. */
function holding(
  context: SessionContext,
  state: ExternalState,
  found: {
    readonly merged: CellMerge;
    readonly base: readonly DocumentCell[];
    readonly text: string;
  },
): ExternalOutcome {
  const base = new Map(found.base.map((cell) => [cell.id, cell]));
  const cells = found.merged.conflicts.flatMap((each) => (each.cell === null ? [] : [each.cell]));
  const previous = new Map(state.held);
  state.held.clear();
  for (const cell of cells) state.held.set(cell, previous.get(cell) ?? base.get(cell) ?? null);
  state.order ||= found.merged.conflicts.some((each) => each.cell === null);
  if (!state.order) context.autosave.rebased(found.text); // the other cells' changes are the base now
  conflictOn(context, cells);
  return "conflict";
}

/** The session takes the merged cells; ours stay on top of the file's where the merge kept them. */
function apply(
  context: SessionContext,
  state: ExternalState,
  file: { readonly theirs: LoadedDocument; readonly merged: CellMerge },
  removing: (cell: CellId) => void,
) {
  const { theirs, merged } = file;
  const next = recordsOf(
    context,
    state,
    { cells: merged.cells, theirs },
    new Set(merged.fromTheirs),
  );
  context.header = theirs.header;
  for (const cell of merged.removed) state.fromDisk.delete(cell);
  return applyRecords(context, next, removing);
}

/** A clean merge: the conflict, if any, is over; the file's text is the base; a write follows when ours stays on top. */
function merge(
  context: SessionContext,
  state: ExternalState,
  found: { readonly text: string; readonly kept: boolean; readonly done: Plan },
): void {
  state.held.clear();
  state.order = false;
  const { text, kept, done } = found;
  context.autosave.reloaded(text, kept);
  const { changed, added, removed } = done;
  if (changed.length + added.length + removed.length > 0 || kept)
    context.emit("notebook.reconciled", {
      path: context.ref,
      outcome: "merged",
      changed: [...changed],
      added: [...added],
      removed: [...removed],
      kept,
    });
}

/** Reads the notebook's file and merges what another program changed in it; see the file's head. */
export async function reconcileExternal(
  context: SessionContext,
  state: ExternalState,
  removing: (cell: CellId) => void,
): Promise<ExternalOutcome> {
  const read = await readSettled(context);
  if (read === undefined) return "missing"; // moved or deleted: the move follower's case (07 §5)
  const base = context.autosave.base();
  if (read.hash === base.hash)
    return state.held.size === 0 && !state.order ? resume(context, base.text) : "same";
  if (read.theirs instanceof Error) return unreadable(context, read.theirs);
  const theirs = read.theirs;
  const ours = context.cells.list().map(documentCell);
  const baseDoc = baseCells(context, state, base.text);
  const held = new Set(state.held.keys());
  const merged = mergeCells(baseDoc, ours, theirs.records.map(documentCell), { held });
  const { dirty } = context.autosave.state();
  const done = apply(context, state, { theirs, merged }, removing);
  if (merged.conflicts.length > 0)
    return holding(context, state, { merged, base: baseDoc, text: read.text });
  // ours' edits on top, ids the file lacked, or runs the file keeps that it does not have yet: a write follows
  const kept =
    merged.keepsOurs || theirs.dirty || (dirty && savesOutputs(context.settings(), theirs.header));
  merge(context, state, { text: read.text, kept, done });
  return "merged";
}

/**
 * A page edit (cell.update's `base`) made on a text the file replaced since: the edit is taken, so the page keeps what
 * it typed, and the cell is held in conflict against the text both started from, the file's version still on disk.
 * Answers whether it was such an edit.
 */
export function staleEdit(
  context: SessionContext,
  state: ExternalState,
  edit: {
    readonly cell: CellId;
    readonly source?: string | undefined;
    readonly base?: string | undefined;
  },
): boolean {
  const record = context.cells.get(edit.cell);
  if (record === undefined || edit.base === undefined || edit.source === undefined) return false;
  if (edit.source === record.source) return false;
  const now = textHash(record.source);
  const disk = state.fromDisk.get(edit.cell);
  if (edit.base === now || disk?.hash !== now) return false;
  state.held.set(edit.cell, { ...documentCell(record), ...disk.before });
  return true;
}

/** The conflict on `cells`: notebook.reconciled says so, then notebook.conflict (autosave suspended). */
export function conflictOn(context: SessionContext, cells: readonly CellId[]): void {
  context.emit("notebook.reconciled", {
    path: context.ref,
    outcome: "conflict",
    ...emptyLists,
    changed: [...cells],
    kept: true,
  });
  context.autosave.conflicted(cells);
}
