// How the grid reads: a cell's tokens, its date and hints, the columns' widths from what they hold,
// the row and cell ids find's matches use, and an SQL result as a grid of its own ("results show in the
// same grid").
import type { Path } from "@jsnb/core";
import { encode, escapeKey } from "@jsnb/core";

import type { SqlRows } from "../model/engines.js";
import type { Hint, HintContext } from "../model/hints.js";
import { hintsFor } from "../model/hints.js";
import type { LeafOptions, Token } from "../model/leaf.js";
import { leafTokens } from "../model/leaf.js";
import { formatPath } from "../model/path.js";
import { preview } from "../model/preview.js";
import type { Cell, Column, Grid } from "../model/records.js";
import { isContainer } from "../model/wire.js";
import { hintLabel } from "./rowView.js";

/** Rows the widths are measured on; a grid is laid out once, not per scroll. Hints (dates read in a time zone) are
 * measured on the first rows only: a column's dates and links read alike. */
const sampled = 200;
const hintSampled = 20;
const minWidth = 4;
const maxWidth = 48;

/** A cell's tokens: a leaf's text, a container's one-line preview, nothing when the row lacks the key. */
export function cellTokens(cell: Cell, options: LeafOptions = {}): Token[] {
  if (!cell.present) return [];
  return isContainer(cell.kind)
    ? preview(cell.node, { ...options, width: maxWidth })
    : leafTokens(cell.node, cell.kind, options);
}

const tokensText = (tokens: readonly Token[]): string => tokens.map((token) => token.text).join("");

/** Each column's width in ch: its header with the filter button, or its widest sampled cell with its padding, between 4
 * and 48. `shown` gives what a cell shows with its hints (a date in place of a unix time); past the first rows the
 * cell's text alone is measured. */
export function columnWidths(
  grid: Grid,
  cellOf: (index: number, column: Column) => Cell,
  shown?: (cell: Cell, path: Path) => number,
): number[] {
  const rows = grid.rows.slice(0, sampled);
  return grid.columns.map((column) => {
    let widest = column.label.length + 7;
    rows.forEach((row, at) => {
      const cell = cellOf(row.index, column);
      const chars =
        shown && at < hintSampled
          ? shown(cell, [row.index, column.key])
          : tokensText(cellTokens(cell)).length;
      widest = Math.max(widest, chars + 3);
    });
    return Math.min(maxWidth, Math.max(minWidth, widest));
  });
}

/** Whether a column holds numbers and nothing else but nulls (its filter then matches `=` a number). */
export function isNumeric(
  grid: Grid,
  column: Column,
  cellOf: (index: number, column: Column) => Cell,
): boolean {
  const cells = grid.rows.slice(0, sampled).map((row) => cellOf(row.index, column));
  const kinds = new Set(cells.map((cell) => (cell.present ? cell.kind : "null")));
  kinds.delete("null");
  return kinds.size === 1 && kinds.has("number");
}

/** The copy-path id of a row (`$[3]`) and of a cell (`$[3].status`), the ids find's matches carry. */
export const rowId = (index: number): string => formatPath([index]);
export const cellId = (index: number, column: Column): string => formatPath([index, column.key]);

/** An SQL result as a grid: its columns in order, each row encoded to the wire form the cells read. */
export function sqlGrid(result: SqlRows): Grid {
  return {
    shape: "records",
    columns: result.columns.map((column) => ({ key: escapeKey(column.name), label: column.name })),
    rows: result.rows.map((row, index) => ({ index, node: encode(row).json })),
    omitted: 0,
  };
}

type TimeHint = Extract<Hint, { readonly kind: "time" }>;

/** What a leaf cell shows besides its text, with hooks given the cell's path from the grid's
 * value. Dates stay compact: a unix time shows as its date and any time keeps both forms in the
 * cell's title, never as a label beside it; links, "View as tree" and add-on hints show as in the tree. */
export type CellHints = {
  readonly time: TimeHint | undefined;
  /** A unix time's date, shown in place of the number. */
  readonly date: string | undefined;
  readonly others: readonly Hint[];
};

export function cellHints(cell: Cell, context: HintContext, path: Path): CellHints {
  const all = cell.present && !isContainer(cell.kind) ? hintsFor(cell.node, context, path) : [];
  const time = all.find((hint): hint is TimeHint => hint.kind === "time");
  const unix = time?.source === "seconds" || time?.source === "milliseconds";
  return {
    time,
    date: unix ? time.absolute : undefined,
    others: all.filter((hint) => hint.kind !== "time"),
  };
}

/** The characters a cell shows with its hints, for the column's width. */
export function shownChars(cell: Cell, context: HintContext, path: Path): number {
  const { date, others } = cellHints(cell, context, path);
  return others.reduce(
    (sum, hint) => {
      const label = hintLabel(hint);
      return label === "" ? sum : sum + label.length + 2;
    },
    date?.length ?? tokensText(cellTokens(cell)).length,
  );
}
