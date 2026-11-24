// Arrow fields as Columns with DuckDB's type names (STRUCT members as `fields`, opaque types by their metadata), and
// the result column names made unique (`a`, `a_1`) so every row key is one column.
import type { Field } from "apache-arrow";
import { DataType, DateUnit, Null, Precision, Type } from "apache-arrow";

import type { Column } from "./engine.ts";
import { opaqueName } from "./opaque.ts";

/** Names made unique in order: a repeated `a` becomes `a_1`, `a_2`, skipping names already taken. */
export function dedupe(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let unique = name;
    for (let count = 1; used.has(unique); count += 1) unique = `${name}_${String(count)}`;
    used.add(unique);
    return unique;
  });
}

const simple: Partial<Record<Type, string>> = {
  [Type.Null]: "NULL",
  [Type.Utf8]: "VARCHAR",
  [Type.LargeUtf8]: "VARCHAR",
  [Type.Bool]: "BOOLEAN",
  [Type.Binary]: "BLOB",
  [Type.LargeBinary]: "BLOB",
  [Type.FixedSizeBinary]: "BLOB",
  [Type.Time]: "TIME",
  [Type.Interval]: "INTERVAL",
};

const integers: Record<number, string> = {
  8: "TINYINT",
  16: "SMALLINT",
  32: "INTEGER",
  64: "BIGINT",
};

/**
 * An Arrow type reached through apache-arrow's untyped accessors (`valueType`, `dictionary` …), checked by its
 * `typeId` (as `DataType.isInt` and its kin check), not `instanceof`: a type built by a second copy of apache-arrow
 * still reads, instead of every column turning NULL.
 */
export const dataType = (value: unknown): DataType => (isDataType(value) ? value : new Null());

/** True for an Arrow type from any copy of apache-arrow: an object whose `typeId` is one of Arrow's. */
export function isDataType(value: unknown): value is DataType {
  const typeId: unknown =
    typeof value === "object" && value !== null ? Reflect.get(value, "typeId") : undefined;
  return typeof typeId === "number" && typeId in Type;
}

const plainName = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const member = (name: string) => (plainName.test(name) ? name : `"${name.replaceAll('"', '""')}"`);

/** A MAP's key and value fields, from its entries STRUCT. */
export function entryFields(type: DataType): readonly Field[] {
  const entries = dataType(type.children[0]?.type);
  return DataType.isStruct(entries) ? entries.children : [];
}

function nestedName(type: DataType): string {
  if (DataType.isList(type)) return `${fieldTypeName(type.children[0])}[]`;
  if (DataType.isFixedSizeList(type)) {
    return `${fieldTypeName(type.children[0])}[${String(type.listSize)}]`;
  }
  if (DataType.isStruct(type)) {
    const members = type.children.map(
      (field: Field<DataType>) => `${member(field.name)} ${fieldTypeName(field)}`,
    );
    return `STRUCT(${members.join(", ")})`;
  }
  if (DataType.isMap(type)) {
    const [key, value] = entryFields(type);
    return `MAP(${fieldTypeName(key)}, ${fieldTypeName(value)})`;
  }
  if (DataType.isDictionary(type)) return typeName(dataType(type.dictionary));
  return Type[type.typeId].toUpperCase();
}

function numericName(type: DataType): string | undefined {
  if (DataType.isInt(type))
    return `${type.isSigned ? "" : "U"}${integers[type.bitWidth] ?? "BIGINT"}`;
  if (DataType.isFloat(type)) return type.precision === Precision.DOUBLE ? "DOUBLE" : "FLOAT";
  if (DataType.isDecimal(type)) return `DECIMAL(${String(type.precision)},${String(type.scale)})`;
  return undefined;
}

function temporalName(type: DataType): string | undefined {
  if (DataType.isDate(type)) return type.unit === DateUnit.DAY ? "DATE" : "TIMESTAMP";
  if (DataType.isTimestamp(type)) return type.timezone ? "TIMESTAMPTZ" : "TIMESTAMP";
  return undefined;
}

/** DuckDB's name for an Arrow type as DuckDB-WASM returns it (Date64 is a TIMESTAMP cast to milliseconds). */
export function typeName(type: DataType): string {
  return simple[type.typeId] ?? numericName(type) ?? temporalName(type) ?? nestedName(type);
}

/** DuckDB's name for a field's type in DuckDB-WASM's result: an opaque type's own (UHUGEINT, BIGNUM), else typeName. */
export function fieldTypeName(field: Field | undefined): string {
  const type = dataType(field?.type);
  return opaqueName(field, type, "duckdb")?.toUpperCase() ?? typeName(type);
}

/** A STRUCT's members, reached also through LIST elements and MAP values. */
function fieldsOf(type: DataType): Column[] {
  if (DataType.isStruct(type)) return type.children.map(toColumn);
  if (DataType.isList(type) || DataType.isFixedSizeList(type) || DataType.isMap(type)) {
    return fieldsOf(dataType(type.valueType));
  }
  if (DataType.isDictionary(type)) return fieldsOf(dataType(type.dictionary));
  return [];
}

/** One Arrow field as a Column. */
export function toColumn(field: Field<DataType>): Column {
  return { name: field.name, type: fieldTypeName(field), fields: fieldsOf(field.type) };
}
