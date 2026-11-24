// CSV of a grid ("CSV for records"), RFC 4180 with CRLF lines and a header row; text cells that a
// spreadsheet would run as a formula start with an apostrophe.
import { leafText } from "./leaf.js";
import { toPlain } from "./plain.js";
import type { Cell, Grid } from "./records.js";
import { cellOf, gridOf } from "./records.js";
import { isContainer, textField } from "./wire.js";

/** The JSON text of a plain value (toPlain's output), empty for undefined, which JSON cannot write. */
export const jsonText = (value: unknown): string =>
  value === undefined ? "" : JSON.stringify(value);

const needsQuotes = /[",\r\n]|^\s|\s$/;
const formula = /^[=+\-@\t\r]/;

/** One field: quoted when it holds a quote, a comma, a line break or edge spaces; formula-like text defused. */
function csvField(text: string, isText: boolean): string {
  const safe = isText && formula.test(text) ? `'${text}` : text;
  return needsQuotes.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** A cell's CSV text: empty for absent, null and undefined; dates as ISO; containers as compact JSON. */
function cellText(cell: Cell, root: unknown): { readonly text: string; readonly isText: boolean } {
  if (!cell.present || cell.kind === "null" || cell.kind === "undefined")
    return { text: "", isText: false };
  if (typeof cell.node === "string") return { text: cell.node, isText: true };
  if (isContainer(cell.kind) || cell.kind === "ref")
    return { text: jsonText(toPlain(cell.node, root)), isText: true };
  const text =
    cell.kind === "date" ? (textField(cell.node, "iso") ?? "") : leafText(cell.node, cell.kind);
  return { text, isText: cell.kind === "error" || cell.kind === "function" };
}

/** The CSV of a grid: a header of column labels, then one line per row, CRLF-terminated. */
function gridCsv(grid: Grid, root: unknown): string {
  const header = grid.columns.map((column) => csvField(column.label, true)).join(",");
  const lines = grid.rows.map((row) =>
    grid.columns
      .map((column) => {
        const { text, isText } = cellText(cellOf(row, column), root);
        return csvField(text, isText);
      })
      .join(","),
  );
  return [header, ...lines].map((line) => `${line}\r\n`).join("");
}

/** The CSV of a value that reads as a grid (records or a matrix), or undefined for any other value. */
export function toCSV(json: unknown, root: unknown = json): string | undefined {
  const grid = gridOf(json, root);
  return grid === undefined ? undefined : gridCsv(grid, root);
}
