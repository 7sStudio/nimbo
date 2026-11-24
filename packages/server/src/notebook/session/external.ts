// External edits of an open notebook's file (07-file-format §5): the file another program changed is merged into the
// session by cell id against the text the daemon last wrote or read (core's mergeCells). A clean merge changes the
// session's cells in place (the file's changes stamped `client: "file"` for review, outputs and status kept where the
// code did not change, the kernel left alone), and writes only when the session's own unsaved edits stay on top; the
// same cell changed on both sides suspends autosave on the conflict path; a file that does not parse leaves the session
// as it is until the next change. Runs in the queue of the file's writes, so a write of the daemon is never taken for
// another program's.
import type { CellId, CellMerge, DocumentCell } from "@jsnb/core";
import { mergeCells } from "@jsnb/core";

import { readNotebook } from "../../files/notebooks/notebookFile.js";
import { analysisOf } from "./analysis.js";
import type { SessionContext } from "./context.js";
import type { LoadedDocument } from "./fileForm.js";
import { loadDocument, savesOutputs } from "./fileForm.js";
import { stamped } from "./provenance.js";
import type { CellRecord } from "./records.js";
import { applyRecords } from "./reload.js";

export type ExternalHooks = {
  /** The page edited the cell a moment ago: a change of it on disk is a conflict, not a replacement under the caret. */
  readonly busy: (cell: CellId) => boolean;
  /** A cell the file removed goes: its queued runs end and the one under way is interrupted. */
  readonly removing: (cell: CellId) => void;
};

export type ExternalOutcome = "same" | "resumed" | "merged" | "conflict" | "unreadable" | "missing";

const documentCell = ({ id, type, source, meta, extra }: CellRecord): DocumentCell => ({
  id,
  type,
  source,
  meta,
  extra,
});

/** The base's cells: the daemon wrote or read that text, so it parses; nothing when there is none. */
function baseCells(context: SessionContext, text: string | undefined): readonly DocumentCell[] {
  if (text === undefined) return [];
  try {
    return loadDocument(text, context.ref, context.ids).records.map(documentCell);
  } catch {
    return [];
  }
}

/** The merged cells as records: a kept cell keeps its runs and status, a cell new from the file takes its saved run;
 * the cells whose code came from the file are stamped as an external edit at `at`. */
function recordsOf(
  context: SessionContext,
  cells: readonly DocumentCell[],
  theirs: LoadedDocument,
  fromTheirs: ReadonlySet<string>,
): CellRecord[] {
  const at = context.now().toISOString();
  const file = new Map(theirs.records.map((record) => [record.id, record]));
  return cells.flatMap((cell): CellRecord[] => {
    const old = context.cells.get(cell.id);
    const before = old ?? { source: "", type: cell.type };
    const meta = fromTheirs.has(cell.id)
      ? {
          ...cell.meta,
          lastEdit: stamped(old?.meta.lastEdit, { client: "file" }, at, { before, after: cell }),
        }
      : cell.meta;
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

/** Takes the file's text into a session whose state its last write or read left alone: the conflict is over. */
function resume(context: SessionContext, text: string | undefined): ExternalOutcome {
  const { conflict, dirty } = context.autosave.state();
  if (!conflict || text === undefined) return "same";
  context.autosave.reloaded(text, false);
  if (dirty) context.autosave.touched();
  return "resumed";
}

function parsed(context: SessionContext, text: string): LoadedDocument | Error {
  try {
    return loadDocument(text, context.ref, context.ids);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
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

function conflicting(context: SessionContext, conflicts: CellMerge["conflicts"]): ExternalOutcome {
  const cells = conflicts.flatMap((each) => (each.cell === null ? [] : [each.cell]));
  context.autosave.conflicted(cells);
  context.emit("notebook.reconciled", {
    path: context.ref,
    outcome: "conflict",
    ...emptyLists,
    changed: cells,
    kept: true,
  });
  return "conflict";
}

/** A clean merge into the session: its cells in place, the file's text the new base, a write when ours stays on top. */
function merge(
  context: SessionContext,
  hooks: ExternalHooks,
  file: { readonly text: string; readonly theirs: LoadedDocument; readonly merged: CellMerge },
): ExternalOutcome {
  const { theirs, merged } = file;
  const { dirty } = context.autosave.state();
  const next = recordsOf(context, merged.cells, theirs, new Set(merged.fromTheirs));
  context.header = theirs.header;
  const { changed, added, removed } = applyRecords(context, next, hooks.removing);
  // ours' edits on top, ids the file lacked, or runs the file keeps that it does not have yet: a write follows
  const kept =
    merged.keepsOurs || theirs.dirty || (dirty && savesOutputs(context.settings(), theirs.header));
  context.autosave.reloaded(file.text, false);
  if (kept) context.autosave.touched();
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

/** Reads the notebook's file and merges what another program changed in it; see the file's head. */
export async function reconcileExternal(
  context: SessionContext,
  hooks: ExternalHooks,
): Promise<ExternalOutcome> {
  const read = await readNotebook(context.path);
  if (read.kind === "missing") return "missing"; // moved or deleted: the move follower's case (07 §5)
  const base = context.autosave.base();
  if (read.hash === base.hash) return resume(context, base.text);
  const theirs = parsed(context, read.text);
  if (theirs instanceof Error) return unreadable(context, theirs);
  const ours = context.cells.list().map(documentCell);
  const busy = new Set(ours.filter((cell) => hooks.busy(cell.id)).map((cell) => cell.id));
  const fromFile = theirs.records.map(documentCell);
  const merged = mergeCells(baseCells(context, base.text), ours, fromFile, { busy });
  if (merged.conflicts.length > 0) return conflicting(context, merged.conflicts);
  return merge(context, hooks, { text: read.text, theirs, merged });
}
