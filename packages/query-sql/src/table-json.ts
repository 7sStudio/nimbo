// A caller's Arrow table as the JSON text the engines load with read_json_auto: its rows through the shared readers,
// with each 64-bit integer the readers give as decimal text (beyond 2^53) written back as a bare number literal, so
// DuckDB reads it exactly and the column stays BIGINT. DuckDB's JSON reader cannot cast a literal above INT64_MAX, so
// a UBIGINT field holding one is written as text instead, every value of it, and a top-level one cast back on load.
import type { Field, Table } from "apache-arrow";
import { DataType } from "apache-arrow";

import { dataType, dedupe, entryFields } from "./columns.ts";
import type { Json, Row } from "./engine.ts";
import { tableRows } from "./result.ts";

/** The table as JSON text, and the top-level columns written as text that the load casts back to UBIGINT. */
export type TableJson = { readonly json: string; readonly unsigned: readonly string[] };

/** What becomes of one integer value, given its Arrow type. */
type Leaf = (value: Json, type: DataType) => unknown;

const int64Max = 9_223_372_036_854_775_807n;
const rawJSON: unknown = Reflect.get(JSON, "rawJSON");

/** Digits that JSON.stringify writes as they are: JSON.rawJSON (Node 21+, Chromium 114+). */
const literal = (digits: string): unknown =>
  typeof rawJSON === "function" ? Reflect.apply(rawJSON, JSON, [digits]) : digits;

const elements = (value: Json, field: Field | undefined, leaf: Leaf): unknown =>
  Array.isArray(value)
    ? value.map((element: Json) => integers(element, dataType(field?.type), leaf))
    : value;

const members = (value: Json, fieldOf: (name: string) => Field | undefined, leaf: Leaf) =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).map(([name, member]) => [
          name,
          integers(member, dataType(fieldOf(name)?.type), leaf),
        ]),
      )
    : value;

/** `value` with `leaf` applied to every integer in it, found by its Arrow type at any depth. */
function integers(value: Json, type: DataType, leaf: Leaf): unknown {
  if (DataType.isInt(type)) return leaf(value, type);
  if (DataType.isDictionary(type)) return integers(value, dataType(type.dictionary), leaf);
  if (DataType.isList(type) || DataType.isFixedSizeList(type)) {
    return elements(value, type.children[0], leaf);
  }
  if (DataType.isStruct(type)) {
    return members(value, (name) => type.children.find((field) => field.name === name), leaf);
  }
  if (DataType.isMap(type)) return members(value, () => entryFields(type)[1], leaf);
  return value;
}

type Column = { readonly name: string; readonly type: DataType };

/** The UBIGINT types (by object) holding a value above INT64_MAX anywhere in the rows. */
function wideTypes(rows: readonly Row[], columns: readonly Column[]): Set<DataType> {
  const wide = new Set<DataType>();
  const scan: Leaf = (value, type) =>
    typeof value === "string" && BigInt(value) > int64Max ? wide.add(type) : value;
  for (const row of rows) {
    for (const { name, type } of columns) integers(row[name] ?? null, type, scan);
  }
  return wide;
}

/** In a wide type every value is text; elsewhere an integer the readers gave as text is a literal again. */
const writer =
  (wide: ReadonlySet<DataType>): Leaf =>
  (value, type) => {
    if (wide.has(type)) return typeof value === "number" ? String(value) : value;
    return typeof value === "string" ? literal(value) : value;
  };

/** The table's rows as JSON text, 64-bit integers exact. */
export function tableJson(table: Table): TableJson {
  const fields = table.schema.fields;
  const names = dedupe(fields.map((field) => field.name));
  const columns = fields.map((field, index) => ({
    name: names[index] ?? field.name,
    type: dataType(field.type),
  }));
  const rows = tableRows(table);
  const wide = wideTypes(rows, columns);
  const write = writer(wide);
  const json = rows.map((row) =>
    Object.fromEntries(
      columns.map(({ name, type }) => [name, integers(row[name] ?? null, type, write)]),
    ),
  );
  const unsigned = columns.filter(({ type }) => wide.has(type)).map(({ name }) => name);
  return { json: JSON.stringify(json), unsigned };
}
