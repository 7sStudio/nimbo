// The notebook diff: the cells of two notebooks matched (match.ts), each row saying what
// changed in the cell's source (hunks of lines), its type and its meta; rows in the new order, a removed cell after the
// nearest earlier cell that survived; the header's changes (version, jsnb, unknown top-level keys).
import type { ComparedRun } from "../analysis/compareRuns.js";
import { compareRuns } from "../analysis/compareRuns.js";
import type { DocumentCell, NotebookDocument, SavedRun } from "../format/schema.js";
import type {
  DiffCellSide,
  DiffRow,
  KeyChange,
  NotebookDiff,
  OutputsChange,
} from "../model/gitDiff.js";
import { longestIncreasing, matchCells } from "./match.js";
import { keyChanges, textDiff } from "./textDiff.js";

/** A cell's meta and its unknown keys as one record: an unknown key reads `extra.<key>`. */
const metaOf = (cell: DocumentCell): Readonly<Record<string, unknown>> => ({
  ...cell.meta,
  ...Object.fromEntries(Object.entries(cell.extra).map(([key, value]) => [`extra.${key}`, value])),
});

const sideOf = (cell: DocumentCell, index: number): DiffCellSide => ({
  id: cell.id,
  index,
  type: cell.type,
  source: cell.source,
  meta: metaOf(cell),
});

/** No saved run, compared as a run that showed nothing. */
const noRun: ComparedRun = { status: "ok", outputs: [] };

/** What changed in a cell's saved run, or undefined when a reader would see nothing change (the times aside). */
export function outputsChange(
  before: SavedRun | undefined,
  after: SavedRun | undefined,
): OutputsChange | undefined {
  if (before === undefined && after === undefined) return undefined;
  const comparison = compareRuns(before ?? noRun, after ?? noRun);
  if (comparison.same && (before === undefined) === (after === undefined)) return undefined;
  return {
    ...(before === undefined ? {} : { before: before.status }),
    ...(after === undefined ? {} : { after: after.status }),
    comparison,
  };
}

type SavedRuns = {
  readonly before?: Readonly<Record<string, SavedRun>> | undefined;
  readonly after?: Readonly<Record<string, SavedRun>> | undefined;
};

/** `{ outputs }` when the saved run changed, else nothing to spread. */
const outputsOf = (before: SavedRun | undefined, after: SavedRun | undefined) => {
  const outputs = outputsChange(before, after);
  return outputs === undefined ? {} : { outputs };
};

type Runs = { readonly before?: SavedRun | undefined; readonly after?: SavedRun | undefined };

function matchedRow(before: DiffCellSide, after: DiffCellSide, runs: Runs = {}): DiffRow {
  const source =
    before.source === after.source ? undefined : textDiff(before.source ?? "", after.source ?? "");
  const type = before.type === after.type ? undefined : { from: before.type, to: after.type };
  const meta = keyChanges(before.meta, after.meta);
  const changes = {
    ...(source === undefined ? {} : { source }),
    ...(type === undefined ? {} : { type }),
    ...(meta.length === 0 ? {} : { meta }),
    ...outputsOf(runs.before, runs.after),
  };
  return {
    status: Object.keys(changes).length === 0 ? "unchanged" : "modified",
    before,
    after,
    changes,
  };
}

/** The header's changes: `version`, `jsnb` and the file's unknown keys; none when a side is missing. */
function headerOf(
  before: NotebookDocument | null,
  after: NotebookDocument | null,
): readonly KeyChange[] {
  if (before === null || after === null) return [];
  const top = (doc: NotebookDocument) => ({
    version: doc.version,
    ...(doc.jsnb === undefined ? {} : { jsnb: doc.jsnb }),
    ...doc.extra,
  });
  return keyChanges(top(before), top(after));
}

/** The removed old cells by the new index of the nearest earlier old cell that survived (-1: none did). */
function removedByAnchor(
  count: number,
  oldToNew: ReadonlyMap<number, number>,
): Map<number, number[]> {
  const anchored = new Map<number, number[]>();
  let anchor = -1;
  for (let old = 0; old < count; old += 1) {
    const fresh = oldToNew.get(old);
    if (fresh !== undefined) anchor = fresh;
    else anchored.set(anchor, [...(anchored.get(anchor) ?? []), old]);
  }
  return anchored;
}

function statsOf(rows: readonly DiffRow[]): NotebookDiff["stats"] {
  const count = (status: DiffRow["status"]) => rows.filter((row) => row.status === status).length;
  return {
    added: count("added"),
    removed: count("removed"),
    modified: count("modified"),
    moved: rows.filter((row) => row.moved !== undefined).length,
    unchanged: count("unchanged"),
  };
}

/** The moved new indexes: matched cells outside the longest run that kept its order. */
function movedOf(
  b: readonly DocumentCell[],
  pairs: ReadonlyMap<number, number>,
): ReadonlySet<number> {
  const matchedNew = b.flatMap((_, at) => (pairs.has(at) ? [at] : []));
  const inPlace = longestIncreasing(matchedNew.map((at) => pairs.get(at) ?? 0));
  return new Set(matchedNew.filter((_, k) => !inPlace.has(k)));
}

/** A removed cell's row, with its saved run when it had one. */
const removedRow = (cell: DocumentCell | undefined, old: number, saved: SavedRuns): DiffRow[] =>
  cell === undefined
    ? []
    : [
        {
          status: "removed",
          before: sideOf(cell, old),
          changes: {
            source: textDiff(cell.source, null),
            ...outputsOf(saved.before?.[cell.id], undefined),
          },
        },
      ];

/** The rows of two cell lists, given their pairs: in the new order, each removed cell after its anchor. */
function rowsOf(
  a: readonly DocumentCell[],
  b: readonly DocumentCell[],
  pairs: ReadonlyMap<number, number>,
  saved: SavedRuns,
): DiffRow[] {
  const moved = movedOf(b, pairs);
  const removed = removedByAnchor(
    a.length,
    new Map([...pairs].map(([fresh, old]) => [old, fresh])),
  );
  const removedRows = (anchor: number): DiffRow[] =>
    (removed.get(anchor) ?? []).flatMap((old) => removedRow(a[old], old, saved));
  const rows: DiffRow[] = [...removedRows(-1)];
  b.forEach((cell, fresh) => {
    const old = pairs.get(fresh);
    const oldCell = old === undefined ? undefined : a[old];
    if (old === undefined || oldCell === undefined)
      rows.push({
        status: "added",
        after: sideOf(cell, fresh),
        changes: {
          source: textDiff(null, cell.source),
          ...outputsOf(undefined, saved.after?.[cell.id]),
        },
      });
    else {
      const row = matchedRow(sideOf(oldCell, old), sideOf(cell, fresh), {
        before: saved.before?.[oldCell.id],
        after: saved.after?.[cell.id],
      });
      rows.push(moved.has(fresh) ? { ...row, moved: { from: old, to: fresh } } : row);
    }
    rows.push(...removedRows(fresh));
  });
  return rows;
}

/** The diff of two notebooks; a null side is a notebook that does not exist there (added or deleted). */
export function diffNotebooks(
  before: NotebookDocument | null,
  after: NotebookDocument | null,
): NotebookDiff {
  const a = before?.cells ?? [];
  const b = after?.cells ?? [];
  const rows = rowsOf(a, b, matchCells(a, b), { before: before?.outputs, after: after?.outputs });
  return { header: headerOf(before, after), rows, stats: statsOf(rows) };
}
