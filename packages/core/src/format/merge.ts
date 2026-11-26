// The three-way merge of a notebook's cells by id (external edits): `base` is what the daemon last
// wrote or read, `ours` the session with its unsaved edits, `theirs` the file as another program left it. Each field
// of a cell (type, source, unknown keys, each meta key) takes the side that changed it; both sides changing one field
// differently is a conflict, as is a cell one side removed and the other changed. `meta.lastEdit` is never a
// conflict: it follows the side that changed it, ours first. The order of the cells both sides kept follows the side
// that reordered them; each side's new cells are placed after the cell they follow on that side.
import type { DocumentCell } from "./schema.js";
import { FileCellMeta } from "./schema.js";

export type MergeConflict = {
  /** The cell, or null for the order. */
  readonly cell: string | null;
  readonly reason: "bothChanged" | "removedOnDisk" | "removedHere" | "bothAdded" | "order";
};

export type CellMerge = {
  readonly cells: readonly DocumentCell[];
  readonly conflicts: readonly MergeConflict[];
  /** Cells whose code (source or type) the result takes from theirs, the cells theirs added included. */
  readonly fromTheirs: readonly string[];
  /** Cells of ours the result drops because theirs removed them. */
  readonly removed: readonly string[];
  /** The result differs from theirs other than in `lastEdit`: ours' unsaved changes that a write has to carry. */
  readonly keepsOurs: boolean;
};

export type MergeOptions = {
  /** Cells of an open conflict: they stay in conflict while theirs differs from both the base and ours. */
  readonly held?: ReadonlySet<string>;
};

type Meta = DocumentCell["meta"];

const defined = (value: object): [string, unknown][] =>
  Object.entries(value).filter(([, item]) => item !== undefined);

function sameObject(a: object, b: object): boolean {
  const left = defined(a);
  const right = new Map(defined(b));
  return (
    left.length === right.size &&
    left.every(([key, value]) => right.has(key) && sameJson(value, right.get(key)))
  );
}

function sameArray(a: object, b: object): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((item, index) => sameJson(item, b[index]));
}

/** Deep equality of JSON values, whatever the order of object keys. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) return sameArray(a, b);
  return sameObject(a, b);
}

const conflicted = Symbol("conflict");
type Merged<T> = T | typeof conflicted;

function pick<T>(base: T, ours: T, theirs: T): Merged<T> {
  if (sameJson(ours, base)) return theirs;
  if (sameJson(theirs, base) || sameJson(ours, theirs)) return ours;
  return conflicted;
}

const withoutEdit = (meta: Meta): Record<string, unknown> =>
  Object.fromEntries(Object.entries(meta).filter(([key]) => key !== "lastEdit"));

/** Whether `cell` differs from `base` other than in lastEdit. */
const changed = (base: DocumentCell, cell: DocumentCell): boolean =>
  base.type !== cell.type ||
  base.source !== cell.source ||
  !sameJson(base.extra, cell.extra) ||
  !sameJson(withoutEdit(base.meta), withoutEdit(cell.meta));

function mergeMeta(base: Meta, ours: Meta, theirs: Meta): Merged<Meta> {
  const keys = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
  keys.delete("lastEdit");
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = pick(Reflect.get(base, key), Reflect.get(ours, key), Reflect.get(theirs, key));
    if (value === conflicted) return conflicted;
    if (value !== undefined) out[key] = value;
  }
  const lastEdit = sameJson(ours.lastEdit, base.lastEdit) ? theirs.lastEdit : ours.lastEdit;
  return FileCellMeta.parse(lastEdit === undefined ? out : { ...out, lastEdit });
}

/** The type changed on one side and the source on the other: merged, a markdown cell would hold code. */
function splitCode(base: DocumentCell, ours: DocumentCell, theirs: DocumentCell): boolean {
  const typed = (cell: DocumentCell) => cell.type !== base.type;
  const sourced = (cell: DocumentCell) => cell.source !== base.source;
  return (
    (typed(ours) && !typed(theirs) && sourced(theirs) && !sourced(ours)) ||
    (typed(theirs) && !typed(ours) && sourced(ours) && !sourced(theirs))
  );
}

/** One cell both sides kept: each field from the side that changed it, or a conflict. */
function mergeCell(
  base: DocumentCell,
  ours: DocumentCell,
  theirs: DocumentCell,
  held: boolean,
): Merged<DocumentCell> {
  if (held && changed(base, theirs) && changed(theirs, ours)) return conflicted;
  if (splitCode(base, ours, theirs)) return conflicted;
  const type = pick(base.type, ours.type, theirs.type);
  const source = pick(base.source, ours.source, theirs.source);
  const extra = pick(base.extra, ours.extra, theirs.extra);
  const meta = mergeMeta(base.meta, ours.meta, theirs.meta);
  if (type === conflicted || source === conflicted || extra === conflicted || meta === conflicted)
    return conflicted;
  return { id: ours.id, type, source, meta, extra };
}

type Sides = {
  readonly base: ReadonlyMap<string, DocumentCell>;
  readonly ours: ReadonlyMap<string, DocumentCell>;
  readonly theirs: ReadonlyMap<string, DocumentCell>;
};

type CellOutcome =
  | { readonly kind: "keep"; readonly cell: DocumentCell; readonly fromTheirs: boolean }
  | { readonly kind: "drop"; readonly removedOurs: boolean }
  | { readonly kind: "conflict"; readonly reason: MergeConflict["reason"] };

const keep = (cell: DocumentCell, fromTheirs = false): CellOutcome => ({
  kind: "keep",
  cell,
  fromTheirs,
});
const drop = (removedOurs: boolean): CellOutcome => ({ kind: "drop", removedOurs });
const conflict = (reason: MergeConflict["reason"]): CellOutcome => ({ kind: "conflict", reason });

/** A cell the base does not have: added on one side, or on both. */
function added(ours: DocumentCell | undefined, theirs: DocumentCell | undefined): CellOutcome {
  if (ours !== undefined && theirs !== undefined)
    return changed(theirs, ours) ? conflict("bothAdded") : keep(ours);
  if (ours !== undefined) return keep(ours);
  return theirs === undefined ? drop(false) : keep(theirs, true);
}

/** A cell of the base that one side removed (or both). */
function removed(
  base: DocumentCell,
  ours: DocumentCell | undefined,
  theirs: DocumentCell | undefined,
  held: boolean,
): CellOutcome {
  if (ours !== undefined)
    return changed(base, ours) || held ? conflict("removedOnDisk") : drop(true);
  if (theirs !== undefined && changed(base, theirs)) return conflict("removedHere");
  return drop(false);
}

/** What becomes of the cell `id`, by which sides have it. */
function outcomeOf(sides: Sides, id: string, held: boolean): CellOutcome {
  const base = sides.base.get(id);
  const ours = sides.ours.get(id);
  const theirs = sides.theirs.get(id);
  if (base === undefined) return added(ours, theirs);
  if (ours === undefined || theirs === undefined) return removed(base, ours, theirs, held);
  const cell = mergeCell(base, ours, theirs, held);
  if (cell === conflicted) return conflict("bothChanged");
  return keep(cell, cell.source !== ours.source || cell.type !== ours.type);
}

const ids = (cells: readonly DocumentCell[]): string[] => cells.map((cell) => cell.id);

/** `primary`'s order, with `other`'s cells it lacks each placed after the cell it follows in `other` (else first). */
function interleave(primary: readonly string[], other: readonly string[]): string[] {
  const out = [...primary];
  const placed = new Set(out);
  other.forEach((id, index) => {
    if (placed.has(id)) return;
    let at = 0;
    for (let back = index - 1; back >= 0; back -= 1) {
      const before = out.indexOf(other[back] ?? "");
      if (before >= 0) {
        at = before + 1;
        break;
      }
    }
    out.splice(at, 0, id);
    placed.add(id);
  });
  return out;
}

type Orders = { readonly base: string[]; readonly ours: string[]; readonly theirs: string[] };

/** The result's order over the `kept` cells, or a conflict when both sides reordered the same cells differently. */
function orderOf(
  orders: Orders,
  kept: ReadonlySet<string>,
): { readonly order: string[]; readonly conflict: boolean } {
  const everywhere = new Set(
    orders.base.filter((id) => orders.ours.includes(id) && orders.theirs.includes(id)),
  );
  const shared = (list: string[]) => list.filter((id) => kept.has(id) && everywhere.has(id));
  const [b, o, t] = [shared(orders.base), shared(orders.ours), shared(orders.theirs)];
  const ours = orders.ours.filter((id) => kept.has(id));
  const theirs = orders.theirs.filter((id) => kept.has(id));
  const oursMoved = !sameJson(o, b);
  const oursFirst = oursMoved && (sameJson(t, b) || sameJson(o, t));
  return {
    order: oursFirst ? interleave(ours, theirs) : interleave(theirs, ours),
    conflict: oursMoved && !sameJson(t, b) && !sameJson(o, t),
  };
}

type Outcomes = {
  readonly kept: Map<string, DocumentCell>;
  readonly conflicts: MergeConflict[];
  readonly fromTheirs: string[];
  readonly removed: string[];
};

/** Every cell's outcome; a conflicting cell stays as ours has it until the conflict is resolved. */
function outcomes(sides: Sides, all: readonly string[], held: ReadonlySet<string>): Outcomes {
  const out: Outcomes = { kept: new Map(), conflicts: [], fromTheirs: [], removed: [] };
  for (const id of all) {
    const outcome = outcomeOf(sides, id, held.has(id));
    if (outcome.kind === "conflict") {
      out.conflicts.push({ cell: id, reason: outcome.reason });
      const ours = sides.ours.get(id);
      if (ours !== undefined) out.kept.set(id, ours);
    } else if (outcome.kind === "keep") {
      out.kept.set(id, outcome.cell);
      if (outcome.fromTheirs) out.fromTheirs.push(id);
    } else if (outcome.removedOurs) out.removed.push(id);
  }
  return out;
}

/** Whether `cells` differ from `theirs` other than in lastEdit. */
function differs(cells: readonly DocumentCell[], theirs: Sides["theirs"], order: string[]) {
  if (!sameJson(ids(cells), order)) return true;
  return cells.some((cell) => {
    const other = theirs.get(cell.id);
    return other === undefined || changed(other, cell);
  });
}

/** Merges `ours` and `theirs` against `base`, cell by cell; see the file's head for the rules. */
export function mergeCells(
  base: readonly DocumentCell[],
  ours: readonly DocumentCell[],
  theirs: readonly DocumentCell[],
  options: MergeOptions = {},
): CellMerge {
  const byId = (cells: readonly DocumentCell[]) => new Map(cells.map((cell) => [cell.id, cell]));
  const sides: Sides = { base: byId(base), ours: byId(ours), theirs: byId(theirs) };
  const all = [...new Set([...ids(base), ...ids(ours), ...ids(theirs)])];
  const found = outcomes(sides, all, options.held ?? new Set());
  const orders = { base: ids(base), ours: ids(ours), theirs: ids(theirs) };
  const { order, conflict: reordered } = orderOf(orders, new Set(found.kept.keys()));
  const conflicts = reordered
    ? [...found.conflicts, { cell: null, reason: "order" as const }]
    : found.conflicts;
  const cells = order.flatMap((id) => {
    const cell = found.kept.get(id);
    return cell === undefined ? [] : [cell];
  });
  const { fromTheirs, removed: dropped } = found;
  const keepsOurs = differs(cells, sides.theirs, orders.theirs);
  return { cells, conflicts, fromTheirs, removed: dropped, keepsOurs };
}
