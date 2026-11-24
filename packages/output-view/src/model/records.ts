// Arrays the grid shows: records sharing ≥ 60 % of their keys, or rows of equal length; typed cells.
import { unescapeKey } from "@jsnb/core";

import type { WireKind } from "./wire.js";
import { isJsonObject, kindOf, refTarget, resolve } from "./wire.js";

/** The share of the union of keys that every record must have for the array to read as a grid. */
export const sharedKeyRatio = 0.6;

/** A column: a record key as written on the wire (escaped) or a matrix index, and its header text. */
export type Column = { readonly key: string | number; readonly label: string };

/** One row: its index in the array and its node, refs resolved to what they point at. */
export type GridRow = { readonly index: number; readonly node: unknown };

/** An array read as a grid; `omitted` counts the truncated markers the kernel left at its end. */
export type Grid = {
  readonly shape: "records" | "matrix";
  readonly columns: readonly Column[];
  readonly rows: readonly GridRow[];
  readonly omitted: number;
};

const recordKinds: ReadonlySet<WireKind> = new Set(["object", "instance"]);

/** A row node with a ref replaced by its target (a repeated record is still a record). */
function rowNode(element: unknown, root: unknown): unknown {
  if (kindOf(element) !== "ref") return element;
  const target = refTarget(element);
  return target === undefined ? element : resolve(root, target)?.node;
}

/** The rows of an array without its trailing truncated markers, refs resolved. */
function rowsOf(items: readonly unknown[], root: unknown): { rows: GridRow[]; omitted: number } {
  let end = items.length;
  while (end > 0 && kindOf(items[end - 1]) === "truncated") end -= 1;
  const rows = items
    .slice(0, end)
    .map((element, index) => ({ index, node: rowNode(element, root) }));
  return { rows, omitted: items.length - end };
}

/** Key counts over the records, in first-seen order; undefined as soon as one row is not a record. */
function keyCounts(rows: readonly GridRow[]): Map<string, number> | undefined {
  const counts = new Map<string, number>();
  for (const { node } of rows) {
    if (!isJsonObject(node) || !recordKinds.has(kindOf(node))) return undefined;
    for (const key in node) {
      if (key !== "$class" && Object.hasOwn(node, key)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function recordColumns(rows: readonly GridRow[]): Column[] | undefined {
  const counts = keyCounts(rows);
  if (counts === undefined || counts.size === 0) return undefined;
  let shared = 0;
  for (const count of counts.values()) if (count === rows.length) shared += 1;
  if (shared / counts.size < sharedKeyRatio) return undefined;
  return [...counts.keys()].map((key) => ({ key, label: unescapeKey(key) }));
}

function matrixColumns(rows: readonly GridRow[]): Column[] | undefined {
  const first = rows[0]?.node;
  const width = Array.isArray(first) ? first.length : 0;
  const equal = rows.every(({ node }) => Array.isArray(node) && node.length === width);
  if (!equal || width === 0) return undefined;
  return Array.from({ length: width }, (_, index) => ({ key: index, label: String(index) }));
}

/**
 * The grid of an array, or undefined when the tree suits it better: at least two rows, every row an object (plain or
 * a class instance) with at least 60 % of the union of keys shared by all, or every row an array of one length.
 * `root` resolves refs among the rows (default: the array itself).
 */
export function gridOf(json: unknown, root: unknown = json): Grid | undefined {
  if (!Array.isArray(json)) return undefined;
  const { rows, omitted } = rowsOf(json, root);
  if (rows.length < 2) return undefined;
  const records = recordColumns(rows);
  if (records) return { shape: "records", columns: records, rows, omitted };
  const matrix = matrixColumns(rows);
  return matrix ? { shape: "matrix", columns: matrix, rows, omitted } : undefined;
}

/** A cell: absent when the record lacks the key (shown empty, sorted last). */
export type Cell =
  | { readonly present: true; readonly node: unknown; readonly kind: WireKind }
  | { readonly present: false };

/** The cell of a row in a column. */
export function cellOf(row: GridRow, column: Column): Cell {
  const node = row.node;
  if (typeof node !== "object" || node === null || !Object.hasOwn(node, column.key)) {
    return { present: false };
  }
  const value: unknown = Reflect.get(node, column.key);
  return { present: true, node: value, kind: kindOf(value) };
}

/** The grid's columns as the user arranged them (`meta.outputColumns`): keys as strings. */
export type ColumnLayout = {
  readonly hidden?: readonly string[];
  readonly order?: readonly string[];
};

const keyOf = (column: Column): string => String(column.key);

/** The columns shown: the layout's order first (keys it names that the grid has), the rest as found, hidden ones out. */
export function arrangeColumns(
  columns: readonly Column[],
  layout: ColumnLayout | undefined,
): readonly Column[] {
  if (layout === undefined) return columns;
  const hidden = new Set(layout.hidden ?? []);
  const byKey = new Map(columns.map((column) => [keyOf(column), column]));
  const ordered = (layout.order ?? []).flatMap((key) => {
    const column = byKey.get(key);
    return column === undefined ? [] : [column];
  });
  const named = new Set(ordered.map(keyOf));
  const rest = columns.filter((column) => !named.has(keyOf(column)));
  return [...ordered, ...rest].filter((column) => !hidden.has(keyOf(column)));
}

/** The grid with its columns arranged; at least one column always stays shown. */
export function arrangeGrid(grid: Grid, layout: ColumnLayout | undefined): Grid {
  const columns = arrangeColumns(grid.columns, layout);
  return columns.length === 0 ? grid : { ...grid, columns };
}

const tidy = (layout: ColumnLayout): ColumnLayout => ({
  ...(layout.hidden !== undefined && layout.hidden.length > 0 ? { hidden: layout.hidden } : {}),
  ...(layout.order !== undefined && layout.order.length > 0 ? { order: layout.order } : {}),
});

/** The layout with `key` hidden (never the last shown column). */
export function hideColumn(
  grid: Grid,
  layout: ColumnLayout | undefined,
  key: string,
): ColumnLayout {
  if (arrangeColumns(grid.columns, layout).length <= 1) return layout ?? {};
  return tidy({ ...layout, hidden: [...new Set([...(layout?.hidden ?? []), key])] });
}

/** The layout with every column shown again, the order kept. */
export const showAllColumns = (layout: ColumnLayout | undefined): ColumnLayout =>
  tidy({ ...layout, hidden: [] });

/** The layout with the shown column `key` moved to `to` (an index among the shown columns). */
export function moveColumn(
  grid: Grid,
  layout: ColumnLayout | undefined,
  key: string,
  to: number,
): ColumnLayout {
  const shown = arrangeColumns(grid.columns, layout).map(keyOf);
  const from = shown.indexOf(key);
  if (from < 0) return layout ?? {};
  const target = Math.max(0, Math.min(shown.length - 1, to));
  const next = shown.filter((name) => name !== key);
  next.splice(target, 0, key);
  const hidden = (layout?.hidden ?? []).filter((name) => !next.includes(name));
  return tidy({ ...layout, order: [...next, ...hidden] });
}
