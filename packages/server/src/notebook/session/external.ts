// External edits of an open notebook's file (07-file-format §5): the file another program changed is merged into the
// session by cell id against the text the daemon last wrote or read (core's mergeCells). The file's changes to cells
// the session left alone change them in place (stamped `client: "file"` for review, outputs and status kept where the
// code did not change, the kernel left alone); a cell both sides changed is held in conflict, with autosave
// suspended, until the user chooses or the file stops differing from it; the daemon writes only when the session's own
// unsaved edits stay on top. An edit whose `base` (cell.update's, cell.run's) is not the cell's text holds its cell in
// conflict too, whatever replaced that text (the file, the page, an agent) and whatever the timing. A file that does not parse is read again once after a moment, then left
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
import type { Editor } from "./provenance.js";
import { stamped } from "./provenance.js";
import type { CellRecord } from "./records.js";
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
  /** Per cell whose text the page's own edits made: that text's textHash and those of the texts its edits were made
   * on, which a draft of the page may still name (one sent before the previous one's answer, which it chains on, was
   * refused). Agents get no such allowance: two of them may share a client name. */
  readonly own: Map<CellId, { readonly last: string; readonly bases: string[] }>;
};

export const externalState = (): ExternalState => ({
  fromDisk: new Map(),
  held: new Map(),
  order: false,
  own: new Map(),
});

/** How many of the page's own earlier texts its edit may name as base. */
const ownBases = 8;

export type ExternalOutcome = "same" | "resumed" | "merged" | "conflict" | "unreadable" | "missing";

export const documentCell = ({ id, type, source, meta, extra }: CellRecord): DocumentCell => ({
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
  merged: CellMerge,
  theirs: LoadedDocument,
): CellRecord[] {
  const at = context.now().toISOString();
  const fromTheirs = new Set(merged.fromTheirs);
  const file = new Map(theirs.records.map((record) => [record.id, record]));
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
  // the session takes the merged cells; ours stay on top of the file's where the merge kept them
  const next = recordsOf(context, state, merged, theirs);
  context.header = theirs.header;
  for (const cell of merged.removed) state.fromDisk.delete(cell);
  const { changed, added, removed } = applyRecords(context, next, removing);
  if (merged.conflicts.length > 0)
    return holding(context, state, { merged, base: baseDoc, text: read.text });
  // a clean merge: the conflict, if any, is over, and the file's text is the base; ours' edits on top, ids the file
  // lacked, or runs the file keeps that it does not have yet: a write follows
  const kept =
    merged.keepsOurs || theirs.dirty || (dirty && savesOutputs(context.settings(), theirs.header));
  state.held.clear();
  state.order = false;
  context.autosave.reloaded(read.text, kept);
  if (changed.length + added.length + removed.length > 0 || kept)
    context.emit("notebook.reconciled", {
      path: context.ref,
      outcome: "merged",
      changed: [...changed],
      added: [...added],
      removed: [...removed],
      kept,
    });
  return "merged";
}

/**
 * An edit whose `base` is not the cell's text (an agent's read before the file or the page changed it, a draft typed on
 * a text replaced since), unless the text is the same editor's own and `base` one it went through: the edit is taken,
 * so its text is kept, and the cell is held in conflict against the text the edit started from when the session knows
 * it (the file's change of it), else against no base, the file's version still on disk. Answers whether it was such an
 * edit.
 */
export function staleEdit(
  context: SessionContext,
  state: ExternalState,
  edit: {
    readonly cell: CellId;
    readonly source?: string | undefined;
    readonly base?: string | undefined;
  },
  editor: Editor,
): boolean {
  const record = context.cells.get(edit.cell);
  if (record === undefined || edit.base === undefined || edit.source === undefined) return false;
  if (edit.source === record.source) return false;
  const now = textHash(record.source);
  // the cell's text is the page's own, and `base` one of the texts its edits went through
  const own = state.own.get(edit.cell);
  const ownText = editor.client === "ui" && own?.last === now && own.bases.includes(edit.base);
  if (edit.base === now || ownText) return false;
  state.held.set(edit.cell, heldBase(state, record, { now, base: edit.base }));
  return true;
}

/** The base a stale edit's cell is held against: the text before the file's change of it, when the edit was made on
 * it or the cell still has the file's text; else none. */
function heldBase(
  state: ExternalState,
  record: CellRecord,
  hashes: { readonly now: string; readonly base: string },
): DocumentCell | null {
  const disk = state.fromDisk.get(record.id);
  if (disk === undefined) return null;
  if (disk.hash !== hashes.now && textHash(disk.before.source) !== hashes.base) return null;
  return { ...documentCell(record), ...disk.before };
}

/** `editor` changed the cell's text from the text hashed `before`: the page's next edit may name either; another
 * editor's edit ends what the page could name. */
export function ownEdit(
  context: SessionContext,
  state: ExternalState,
  edit: { readonly cell: CellId; readonly before: string; readonly stale: boolean },
  editor: Editor,
): void {
  const record = context.cells.get(edit.cell);
  if (record === undefined) return;
  if (editor.client !== "ui") {
    state.own.delete(edit.cell);
    return;
  }
  const previous = state.own.get(edit.cell);
  const bases = previous?.last === edit.before ? previous.bases : [];
  state.own.set(edit.cell, {
    last: textHash(record.source),
    bases: (edit.stale ? bases : [...bases, edit.before]).slice(-ownBases),
  });
}

/** The conflict on `cells`: notebook.reconciled says so, then notebook.conflict (autosave suspended) with every cell
 * held, `cells` among them. */
export function conflictOn(
  context: SessionContext,
  cells: readonly CellId[],
  held: readonly CellId[] = cells,
): void {
  context.emit("notebook.reconciled", {
    path: context.ref,
    outcome: "conflict",
    ...emptyLists,
    changed: [...cells],
    kept: true,
  });
  context.autosave.conflicted(held);
}

/** An edit without `base` over a source the file on disk set since the session's own last edit of the cell: its
 * caller may not have read that source (an agent working from its own copy), so the answer says so. */
export function diskNotice(
  context: SessionContext,
  state: ExternalState,
  edit: {
    readonly cell: CellId;
    readonly source?: string | undefined;
    readonly base?: string | undefined;
  },
): string | undefined {
  const record = context.cells.get(edit.cell);
  if (record === undefined || edit.base !== undefined || edit.source === undefined)
    return undefined;
  if (
    edit.source === record.source ||
    state.fromDisk.get(edit.cell)?.hash !== textHash(record.source)
  )
    return undefined;
  return `${edit.cell} had changed on disk since; its source from the file was replaced. Read it again (cell.get) and pass its textHash as base.`;
}
