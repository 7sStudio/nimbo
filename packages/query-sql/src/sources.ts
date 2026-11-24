// What a table source is (rows, a Blob of JSON, an Arrow table) and rows or a table as the JSON text DuckDB reads. An
// Arrow table is known by its shape, so one built by another copy of apache-arrow is read too, through its rows.
import { Table } from "apache-arrow";

import { isDataType } from "./columns.ts";
import type { TableSource } from "./engine.ts";
import type { Outcome } from "./errors.ts";
import { QueryError, messages } from "./errors.ts";
import type { TableJson } from "./table-json.ts";
import { tableJson } from "./table-json.ts";

export type Source =
  | { readonly kind: "rows"; readonly rows: readonly unknown[] }
  | { readonly kind: "blob"; readonly blob: Blob }
  /** `native`: built by this copy of apache-arrow, so the page can hand it to DuckDB-WASM as Arrow. */
  | { readonly kind: "arrow"; readonly table: Table; readonly native: boolean };

const read = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;

const isField = (field: unknown) =>
  typeof read(field, "name") === "string" && isDataType(read(field, "type"));

/** A table as any copy of apache-arrow builds it: a schema of typed fields, record batches and a row count. */
function isTableShaped(value: unknown): value is Table {
  const fields = read(read(value, "schema"), "fields");
  const batches = read(value, "batches");
  return (
    Array.isArray(fields) &&
    fields.every(isField) &&
    Array.isArray(batches) &&
    batches.every((batch) => typeof read(batch, "numRows") === "number") &&
    typeof read(value, "numRows") === "number"
  );
}

/** The source by kind; anything else is QueryError("input"). */
export function classify(table: string, source: TableSource): Outcome<Source> {
  if (Array.isArray(source)) return { ok: true, value: { kind: "rows", rows: source } };
  if (source instanceof Blob) return { ok: true, value: { kind: "blob", blob: source } };
  if (source instanceof Table)
    return { ok: true, value: { kind: "arrow", table: source, native: true } };
  if (isTableShaped(source))
    return { ok: true, value: { kind: "arrow", table: source, native: false } };
  return { ok: false, error: new QueryError("input", messages.source(table)) };
}

const isRecord = (row: unknown): boolean =>
  typeof row === "object" && row !== null && !Array.isArray(row);

/**
 * The rows DuckDB reads: a list with no record in it (numbers, strings, arrays) becomes one column named `value`, as
 * DuckDB's own `unnest` names it, where read_json_auto would call it `json`; a list with records stays as it is.
 */
const tableRows = (rows: readonly unknown[]): readonly unknown[] =>
  rows.length > 0 && !rows.some(isRecord) ? rows.map((value) => ({ value })) : rows;

/** Rows as JSON text; a BigInt or a cycle is QueryError("input") naming the table. */
export function encodeRows(table: string, rows: readonly unknown[]): Outcome<string> {
  try {
    return { ok: true, value: JSON.stringify(tableRows(rows)) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: new QueryError("input", messages.rows(table, detail), { cause: error }),
    };
  }
}

/**
 * An Arrow table as JSON text, 64-bit integers exact: how the daemon loads every table and the page one from another
 * copy of apache-arrow. A column the readers cannot take is QueryError("input") naming the table.
 */
export function encodeTable(table: string, source: Table): Outcome<TableJson> {
  try {
    return { ok: true, value: tableJson(source) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: new QueryError("input", messages.arrow(table, detail), { cause: error }),
    };
  }
}

/** Rows or an Arrow table as the JSON text DuckDB loads, and the columns to cast back to UBIGINT; throws `input`. */
export function encodeSource(
  table: string,
  source: Exclude<Source, { readonly kind: "blob" }>,
): TableJson {
  if (source.kind === "rows") {
    const json = encodeRows(table, source.rows);
    if (!json.ok) throw json.error;
    return { json: json.value, unsigned: [] };
  }
  const encoded = encodeTable(table, source.table);
  if (!encoded.ok) throw encoded.error;
  return encoded.value;
}
