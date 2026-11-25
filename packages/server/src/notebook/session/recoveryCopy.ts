// A session's recovery copy (07-file-format §7, files/notebooks/recovery.ts): kept while the session holds text the
// file does not and cannot write it (an open conflict, a failing save, a close that could not write), so neither a
// close, a stop nor a crash drops it; and taken back at the next open as a conflict with that text as the session's.
import type { CellId, DocumentCell } from "@jsnb/core";
import { mergeCells, sameJson } from "@jsnb/core";

import { readRecovery, removeRecovery, writeRecovery } from "../../files/notebooks/recovery.js";
import { analysisOf } from "./analysis.js";
import type { SessionContext } from "./context.js";
import type { ExternalState } from "./external.js";
import { conflictOn, documentCell } from "./external.js";
import { loadDocument } from "./fileForm.js";
import type { CellRecord } from "./records.js";
import { applyRecords } from "./reload.js";

const quietMs = 200;

type Keeper = {
  timer: ReturnType<typeof setTimeout> | undefined;
  wanted: boolean;
  present: boolean;
};

/** Writes the copy while it is wanted, removes the one there when not. */
async function syncCopy(
  dir: string,
  context: SessionContext,
  keeper: Keeper,
  text: () => string,
): Promise<void> {
  if (keeper.wanted) {
    const base = context.autosave.base().text ?? null;
    const at = context.now().toISOString();
    await writeRecovery(dir, { version: 1, notebook: context.ref, at, base, mine: text() });
    keeper.present = true;
  } else if (keeper.present) {
    await removeRecovery(dir, context.ref);
    keeper.present = false;
  }
}

/** The autosave's recovery hook: the copy written (debounced, or at once) while needed, removed when not. */
export function recoveryKeeper(dir: string, context: SessionContext, text: () => string) {
  const keeper: Keeper = { timer: undefined, wanted: false, present: false };
  let chain: Promise<void> = Promise.resolve();
  const sync = (): Promise<void> => {
    chain = chain
      .then(() => syncCopy(dir, context, keeper, text))
      .catch((error: unknown) => {
        context.log.warn(
          { err: error, notebook: context.ref },
          "the recovery copy could not be kept",
        );
      });
    return chain;
  };
  return {
    /** A copy was found at open: it is ours to remove once the file holds the state. */
    found: () => {
      keeper.present = true;
    },
    keep: (needed: boolean, now = false): Promise<void> => {
      keeper.wanted = needed;
      if (!needed) context.recovered = undefined;
      clearTimeout(keeper.timer);
      if (!needed || now) return sync();
      keeper.timer = setTimeout(() => void sync(), quietMs);
      keeper.timer.unref();
      return Promise.resolve();
    },
  };
}

const parsedCells = (
  context: SessionContext,
  text: string | null,
): readonly CellRecord[] | undefined => {
  if (text === null) return undefined;
  try {
    return loadDocument(text, context.ref, context.ids).records;
  } catch {
    return undefined;
  }
};

/** The session's cells with the recovered ones: a cell of the file keeps its runs and takes the text. */
function recoveredRecords(
  context: SessionContext,
  cells: readonly DocumentCell[],
  mine: readonly CellRecord[],
) {
  const recovered = new Map(mine.map((record) => [record.id, record]));
  return cells.flatMap((cell): CellRecord[] => {
    const old = context.cells.get(cell.id);
    if (old === undefined) {
      const added = recovered.get(cell.id);
      return added === undefined ? [] : [{ ...added, ...cell }];
    }
    const code = old.source !== cell.source || old.type !== cell.type;
    return [
      { ...old, ...cell, analysis: code ? analysisOf(cell.type, cell.source) : old.analysis },
    ];
  });
}

/**
 * At open: a recovery copy whose text is not the file's reopens the conflict with that text as the session's (the
 * file's changes since merged around it), the cells it differs in held against the copy's base; a copy the file
 * already holds, or one that cannot be read, is removed. Answers whether a copy was found and kept.
 */
export async function recoverOnOpen(
  dir: string,
  context: SessionContext,
  state: ExternalState,
): Promise<boolean> {
  const copy = await readRecovery(dir, context.ref);
  if (copy === undefined) return false;
  const mine = parsedCells(context, copy.mine);
  if (mine === undefined || copy.mine === context.autosave.base().text) {
    await removeRecovery(dir, context.ref);
    return false;
  }
  const file = context.cells.list().map(documentCell);
  const base = (parsedCells(context, copy.base) ?? []).map(documentCell);
  const merged = mergeCells(base.length > 0 ? base : file, mine.map(documentCell), file);
  const onDisk = new Map(file.map((cell) => [cell.id, cell]));
  const kept = new Set(merged.cells.map((cell) => cell.id));
  const held: CellId[] = [
    ...merged.cells.filter((cell) => !sameJson(cell, onDisk.get(cell.id))).map((cell) => cell.id),
    ...file.filter((cell) => !kept.has(cell.id)).map((cell) => cell.id),
  ];
  if (held.length === 0) {
    await removeRecovery(dir, context.ref);
    return false;
  }
  applyRecords(context, recoveredRecords(context, merged.cells, mine));
  const baseById = new Map(base.map((cell) => [cell.id, cell]));
  for (const cell of held) state.held.set(cell, baseById.get(cell) ?? onDisk.get(cell) ?? null);
  context.recovered = copy.at;
  conflictOn(context, held);
  return true;
}
