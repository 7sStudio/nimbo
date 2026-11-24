// `--format csv` (03-api §8): RFC 4180 lines with CRLF and a header row. A table, for export, is a SQL answer (its
// columns, the header even with no rows), or a value that is a non-empty array of records (the columns the union of
// their keys, in first-seen order) or of arrays of one length (columns 0 … n-1); one row is a table. The viewer's
// display rule (two rows, 60 % of keys shared) chooses a grid to show, not what may be exported. Text a spreadsheet
// would run as a formula starts with an apostrophe, as output-view's csv.ts does; its csvField is not exported from the
// model subpath (only toCSV, which takes the viewer's grid), so the field rule is written here, nulls and containers
// too.
import { toPlain } from "@jsnb/output-view/model";

const needsQuotes = /[",\r\n]|^\s|\s$/;
const formula = /^[=+\-@\t\r]/;

/** One field: empty for null and a missing key, containers as compact JSON, quoted when it must be. */
function field(value: unknown): string {
  if (value === null || value === undefined) return "";
  const isText = typeof value === "string";
  // toPlain leaves strings, numbers, booleans and containers: a container is its compact JSON, the rest JSON's text.
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const safe = isText && formula.test(text) ? `'${text}` : text;
  return needsQuotes.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** The CSV of a header and its rows. */
const csvOf = (header: readonly string[], rows: readonly (readonly unknown[])[]): string =>
  [header, ...rows].map((cells) => `${cells.map(field).join(",")}\r\n`).join("");

type Table = { readonly header: readonly string[]; readonly rows: readonly (readonly unknown[])[] };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/** A plain value as a table, or undefined when it is none. */
function tableOf(plain: unknown): Table | undefined {
  if (!isList(plain) || plain.length === 0) return undefined;
  const items = plain;
  if (items.every(isRecord)) {
    const header = [...new Set(items.flatMap((item) => (isRecord(item) ? Object.keys(item) : [])))];
    if (header.length === 0) return undefined;
    return {
      header,
      rows: items.map((item) => header.map((key) => (isRecord(item) ? item[key] : undefined))),
    };
  }
  const rows = items.filter(isList);
  const width = rows[0]?.length ?? 0;
  if (width === 0 || rows.length !== items.length || rows.some((row) => row.length !== width))
    return undefined;
  return { header: Array.from({ length: width }, (_, column) => String(column)), rows };
}

/** The CSV of a wire-form value that is a table, or undefined. */
export function valueCsv(json: unknown): string | undefined {
  const table = tableOf(toPlain(json));
  return table === undefined ? undefined : csvOf(table.header, table.rows);
}

/** The CSV of a SQL answer: its columns, then its rows (records keyed by column, as DuckDB gives them). */
export function sqlCsv(columns: readonly string[], rows: readonly unknown[]): string {
  return csvOf(
    columns,
    rows.map((row) => columns.map((name) => (isRecord(row) ? row[name] : undefined))),
  );
}
