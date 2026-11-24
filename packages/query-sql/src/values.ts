// Arrow values as Json, read from each Data's own buffers by row index, never through arrow-js slices (which offset
// twice and cut MONTH_DAY_NANO short): one reader per column, compiled once, nested types through their children,
// each with its Field, so DuckDB's opaque integers (UHUGEINT, BIGNUM) read at any depth.
import type { Data, Field, Vector } from "apache-arrow";
import { DataType, makeVector } from "apache-arrow";

import { dataType, entryFields } from "./columns.ts";
import type { Json } from "./engine.ts";
import { QueryError, messages } from "./errors.ts";
import type { Origin } from "./opaque.ts";
import { opaqueName, opaqueReader } from "./opaque.ts";
import type { Read } from "./scalars.ts";
import { scalarReader } from "./scalars.ts";

const at = (values: unknown, index: number): number => {
  const value: unknown =
    ArrayBuffer.isView(values) && !(values instanceof DataView) ? Reflect.get(values, index) : 0;
  return typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : 0;
};

/** True when the row is not null: the validity bitmap counts from the Data's offset, as arrow-js keeps it. */
function valid(data: Data, row: number): boolean {
  const bitmap: unknown = data.nullBitmap;
  if (!(bitmap instanceof Uint8Array) || bitmap.length === 0 || data.nullCount === 0) return true;
  const bit = data.offset + row;
  return ((bitmap[bit >> 3] ?? 0) & (1 << (bit & 7))) !== 0;
}

/** The reader for one Data and its Field (null rows read as null), compiled once and applied to every row. */
function compile(data: Data, field: Field | undefined, origin: Origin): Read {
  const type = dataType(data.type);
  if (DataType.isNull(type)) return () => null;
  const opaque = opaqueName(field, type, origin);
  const read =
    opaque === undefined
      ? (scalarReader(data, type) ?? nestedReader(data, type, origin) ?? fallback(data))
      : opaqueReader(data, opaque);
  return (row) => (valid(data, row) ? read(row) : null);
}

/** What neither reader knows (a union, a duration …): arrow-js's own value as text. */
const fallback = (data: Data): Read => {
  const vector = makeVector(data);
  return (row) => String(vector.get(row));
};

/** LIST and MAP: each of the child's rows from `valueOffsets[row]` to `valueOffsets[row + 1]`, as `each` makes it. */
const spans = <T>(data: Data, each: (child: number) => T): ((row: number) => T[]) => {
  const offsets: unknown = data.valueOffsets;
  return (row) => {
    const out: T[] = [];
    for (let child = at(offsets, row); child < at(offsets, row + 1); child += 1)
      out.push(each(child));
    return out;
  };
};

const keyText = (key: Json) => (typeof key === "string" ? key : JSON.stringify(key));

function mapReader(data: Data, type: DataType, origin: Origin): Read {
  const entries = data.children[0];
  const keys = entries?.children[0];
  const items = entries?.children[1];
  if (keys === undefined || items === undefined) return () => ({});
  const [keyField, itemField] = entryFields(type);
  const key = compile(keys, keyField, origin);
  const item = compile(items, itemField, origin);
  const pairs = spans(data, (child): [string, Json] => [keyText(key(child)), item(child)]);
  return (row) => Object.fromEntries(pairs(row));
}

/** STRUCT, and a UNION's members: each child with the field the type gives it. */
const children = (data: Data, type: DataType, origin: Origin): Read[] =>
  data.children.map((child, index) => compile(child, type.children[index], origin));

function structReader(data: Data, type: DataType, origin: Origin): Read {
  const names = type.children.map((field) => field.name);
  const members = children(data, type, origin);
  return (row) =>
    Object.fromEntries(names.map((name, index) => [name, members[index]?.(row) ?? null]));
}

function listReader(data: Data, type: DataType, origin: Origin): Read {
  const child = data.children[0];
  if (child === undefined) return () => [];
  const element = compile(child, type.children[0], origin);
  if (!DataType.isFixedSizeList(type)) return spans(data, element);
  const size = type.listSize;
  return (row) => Array.from({ length: size }, (_, index) => element(row * size + index));
}

function dictionaryReader(data: Data, origin: Origin): Read {
  if (data.dictionary === undefined || data.dictionary.length === 0) {
    // DuckDB-WASM streams an ENUM's indices without the dictionary batch that holds its labels.
    return () => {
      throw new QueryError("query", messages.enumeration());
    };
  }
  const values = vectorToJson(data.dictionary, origin);
  const indices: unknown = data.values;
  return (row) => values[at(indices, row)] ?? null;
}

/** UNION: the value of the member each row's type id names (sparse: same row; dense: through valueOffsets). */
function unionReader(data: Data, type: DataType, origin: Origin): Read {
  const typeIds: unknown = data.typeIds;
  const offsets: unknown = data.valueOffsets;
  const members = children(data, type, origin);
  const dense = DataType.isDenseUnion(type);
  const childIndex: unknown = Reflect.get(type, "typeIdToChildIndex");
  return (row) => {
    const id = at(typeIds, row);
    const index: unknown =
      typeof childIndex === "object" && childIndex !== null ? Reflect.get(childIndex, id) : id;
    const member = typeof index === "number" ? members[index] : undefined;
    return member === undefined ? null : member(dense ? at(offsets, row) : row);
  };
}

function nestedReader(data: Data, type: DataType, origin: Origin): Read | undefined {
  if (DataType.isStruct(type)) return structReader(data, type, origin);
  if (DataType.isList(type) || DataType.isFixedSizeList(type)) {
    return listReader(data, type, origin);
  }
  if (DataType.isMap(type)) return mapReader(data, type, origin);
  if (DataType.isDictionary(type)) return dictionaryReader(data, origin);
  if (DataType.isUnion(type)) return unionReader(data, type, origin);
  return undefined;
}

/** The first `count` rows of one column's Data, read with its schema Field (whose metadata names opaque types). */
export function columnToJson(
  data: Data,
  count: number,
  field: Field | undefined,
  origin: Origin,
): Json[] {
  const read = compile(data, field, origin);
  return Array.from({ length: count }, (_, row) => read(row));
}

/** Every value of a vector, chunk by chunk: a caller's table unless `origin` says DuckDB-WASM made it. */
export function vectorToJson(vector: Vector, origin: Origin = "table"): Json[] {
  return vector.data.flatMap((chunk: Data) => columnToJson(chunk, chunk.length, undefined, origin));
}
