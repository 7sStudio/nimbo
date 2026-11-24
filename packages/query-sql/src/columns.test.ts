// Arrow types as DuckDB type names, STRUCT members as fields, and result column names made unique.
import {
  Binary,
  Bool,
  DateDay,
  DateMillisecond,
  Decimal,
  Dictionary,
  Field,
  FixedSizeBinary,
  FixedSizeList,
  Float32,
  Float64,
  Int16,
  Int32,
  Int64,
  Int8,
  IntervalDayTime,
  List,
  Null,
  Struct,
  TimeMicrosecond,
  TimestampMillisecond,
  Uint64,
  Uint8,
  Utf8,
  DurationSecond,
} from "apache-arrow";
import { describe, expect, it } from "vitest";

import { DataType, Type } from "apache-arrow";

import { dataType, dedupe, toColumn, typeName } from "./columns.ts";
import { mapOf } from "./fixtures/arrow-types.ts";

const struct = new Struct([new Field("amount", new Int64()), new Field("object", new Utf8())]);

describe("typeName", () => {
  it("names the scalar types the DuckDB way", () => {
    const cases: [ReturnType<typeof dataType>, string][] = [
      [new Int8(), "TINYINT"],
      [new Int16(), "SMALLINT"],
      [new Int32(), "INTEGER"],
      [new Int64(), "BIGINT"],
      [new Uint8(), "UTINYINT"],
      [new Uint64(), "UBIGINT"],
      [new Float32(), "FLOAT"],
      [new Float64(), "DOUBLE"],
      [new Utf8(), "VARCHAR"],
      [new Bool(), "BOOLEAN"],
      [new DateDay(), "DATE"],
      [new DateMillisecond(), "TIMESTAMP"],
      [new TimestampMillisecond(), "TIMESTAMP"],
      [new TimestampMillisecond("UTC"), "TIMESTAMPTZ"],
      [new TimeMicrosecond(), "TIME"],
      [new Binary(), "BLOB"],
      [new IntervalDayTime(), "INTERVAL"],
      [new Null(), "NULL"],
      [new Decimal(2, 10, 128), "DECIMAL(10,2)"],
      [new DurationSecond(), "DURATION"],
    ];
    for (const [type, name] of cases) expect(typeName(type)).toBe(name);
  });

  it("names lists, arrays, structs, maps and dictionaries by their children", () => {
    expect(typeName(new List(new Field("item", new Utf8())))).toBe("VARCHAR[]");
    expect(typeName(new FixedSizeList(3, new Field("item", new Int32())))).toBe("INTEGER[3]");
    expect(typeName(new Struct([new Field("a b", new Int32()), new Field("c", struct)]))).toBe(
      'STRUCT("a b" INTEGER, c STRUCT(amount BIGINT, object VARCHAR))',
    );
    expect(typeName(mapOf(new Utf8(), new Int32()))).toBe("MAP(VARCHAR, INTEGER)");
    expect(typeName(new Dictionary(new Utf8(), new Int32()))).toBe("VARCHAR");
  });
});

describe("toColumn", () => {
  it("lists a STRUCT's members, also through LIST elements and MAP values", () => {
    expect(toColumn(new Field("data", new Struct([new Field("object", struct)])))).toEqual({
      name: "data",
      type: "STRUCT(object STRUCT(amount BIGINT, object VARCHAR))",
      fields: [
        {
          name: "object",
          type: "STRUCT(amount BIGINT, object VARCHAR)",
          fields: [
            { name: "amount", type: "BIGINT", fields: [] },
            { name: "object", type: "VARCHAR", fields: [] },
          ],
        },
      ],
    });
    expect(toColumn(new Field("lines", new List(new Field("item", struct)))).fields).toHaveLength(
      2,
    );
    expect(toColumn(new Field("m", mapOf(new Utf8(), struct))).fields).toHaveLength(2);
    expect(toColumn(new Field("d", new Dictionary(struct, new Int32()))).fields).toHaveLength(2);
    expect(toColumn(new Field("n", new Int32())).fields).toEqual([]);
  });

  it("names DuckDB's opaque types by their metadata, at any depth", () => {
    const metadata = (name: string) =>
      new Map([
        ["ARROW:extension:name", "arrow.opaque"],
        ["ARROW:extension:metadata", JSON.stringify({ type_name: name, vendor_name: "DuckDB" })],
      ]);
    const uhugeint = new Field("u", new FixedSizeBinary(16), true, metadata("uhugeint"));
    const bignum = new Field("item", new Binary(), true, metadata("bignum"));
    expect(toColumn(uhugeint).type).toBe("UHUGEINT");
    expect(toColumn(new Field("l", new List(bignum))).type).toBe("BIGNUM[]");
    expect(toColumn(new Field("s", new Struct([uhugeint]))).type).toBe("STRUCT(u UHUGEINT)");
    // A MAP's fields lose the metadata; DuckDB-WASM sends no FixedSizeBinary(16) but UHUGEINT.
    const map = mapOf(new Utf8(), new FixedSizeBinary(16));
    expect(toColumn(new Field("m", map)).type).toBe("MAP(VARCHAR, UHUGEINT)");
  });
});

describe("dedupe", () => {
  it("suffixes repeats with _1, _2 and skips names already taken", () => {
    expect(dedupe(["a", "a", "b", "a"])).toEqual(["a", "a_1", "b", "a_2"]);
    expect(dedupe(["a", "a", "a_1"])).toEqual(["a", "a_1", "a_1_1"]);
  });
});

describe("dataType", () => {
  it("passes an Arrow type through and stands in NULL for anything else", () => {
    const type = new Utf8();
    expect(dataType(type)).toBe(type);
    expect(typeName(dataType(undefined))).toBe("NULL");
  });

  it("recognises a type by its typeId, so a second copy of apache-arrow still reads", () => {
    // A type object from another apache-arrow copy is not an instance of this copy's DataType.
    const foreign = { typeId: Type.Int, isSigned: true, bitWidth: 32, children: [] };
    expect(foreign instanceof DataType).toBe(false);
    expect(typeName(dataType(foreign))).toBe("INTEGER");
    expect(typeName(dataType({ typeId: "Int" }))).toBe("NULL");
  });
});
