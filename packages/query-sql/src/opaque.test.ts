// DuckDB's opaque integers (UHUGEINT, BIGNUM) from their bytes as DuckDB-WASM sends them, named by the field's
// metadata at any depth or, in a DuckDB-WASM result's MAP, by their FixedSizeBinary(16) type; others refused.
import { Binary, Field, FixedSizeBinary, Struct, makeData, makeVector } from "apache-arrow";
import type { DataType } from "apache-arrow";
import { describe, expect, it } from "vitest";

import { QueryError } from "./errors.ts";
import { bignum, opaqueName, uhugeint } from "./opaque.ts";
import { columnToJson, vectorToJson } from "./values.ts";

/** Bytes from hex digits, as the page printed these values before it decoded them. */
const bytes = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

const opaque = (name: string, type: DataType, typeName: string, metadata?: string) =>
  new Field(
    name,
    type,
    true,
    new Map([
      ["ARROW:extension:name", "arrow.opaque"],
      [
        "ARROW:extension:metadata",
        metadata ?? JSON.stringify({ type_name: typeName, vendor_name: "DuckDB" }),
      ],
    ]),
  );

const sixteen = (...rows: string[]) =>
  makeData({ type: new FixedSizeBinary(16), length: rows.length, data: bytes(rows.join("")) });

const variable = (...rows: string[]) => {
  const offsets = [0];
  for (const row of rows) offsets.push((offsets.at(-1) ?? 0) + row.length / 2);
  const type = new Binary();
  const valueOffsets = Int32Array.from(offsets);
  return makeData({ type, length: rows.length, valueOffsets, data: bytes(rows.join("")) });
};

describe("opaque integers from their bytes", () => {
  it("reads UHUGEINT as an unsigned little-endian integer", () => {
    expect(uhugeint(bytes("05000000000000000000000000000000"))).toBe(5n);
    expect(uhugeint(bytes("ff".repeat(16)))).toBe(2n ** 128n - 1n);
  });

  it("reads BIGNUM's header, sign and magnitude, negatives with every bit flipped", () => {
    expect(bignum(bytes("8000017b"))).toBe(123n);
    expect(bignum(bytes("7ffffe84"))).toBe(-123n);
    expect(bignum(bytes("80000100"))).toBe(0n);
    expect(bignum(bytes("7ffffdfeff"))).toBe(-256n);
    expect(bignum(bytes("7ffff6bfffffffffffffffff"))).toBe(-(2n ** 70n));
  });
});

describe("opaqueName", () => {
  const binary16 = new FixedSizeBinary(16);
  it("names a field by its metadata, and a malformed one as opaque", () => {
    expect(opaqueName(opaque("u", binary16, "uhugeint"), binary16, "table")).toBe("uhugeint");
    expect(opaqueName(opaque("b", new Binary(), "", "{"), new Binary(), "duckdb")).toBe("opaque");
    expect(opaqueName(opaque("b", new Binary(), "", "[]"), new Binary(), "duckdb")).toBe("opaque");
  });

  it("takes an unlabelled FixedSizeBinary(16) as UHUGEINT only in a DuckDB-WASM result", () => {
    expect(opaqueName(new Field("v", binary16), binary16, "duckdb")).toBe("uhugeint");
    expect(opaqueName(undefined, binary16, "duckdb")).toBe("uhugeint");
    expect(opaqueName(new Field("v", binary16), binary16, "table")).toBeUndefined();
    const uuid = new Field("id", binary16, true, new Map([["ARROW:extension:name", "arrow.uuid"]]));
    expect(opaqueName(uuid, binary16, "duckdb")).toBeUndefined();
    expect(opaqueName(undefined, new FixedSizeBinary(8), "duckdb")).toBeUndefined();
  });
});

describe("opaque columns as Json", () => {
  it("reads UHUGEINT and BIGNUM by the bigint rule, at the top level and in a STRUCT", () => {
    const top = sixteen("ff".repeat(16), "07000000000000000000000000000000");
    const field = opaque("u", top.type, "uhugeint");
    expect(columnToJson(top, 2, field, "duckdb")).toEqual([
      "340282366920938463463374607431768211455",
      7,
    ]);
    const member = opaque("b", new Binary(), "bignum");
    const struct = makeData({
      type: new Struct([member]),
      length: 2,
      children: [variable("7ffffe84", "800009400000000000000000")],
    });
    expect(columnToJson(struct, 2, new Field("s", struct.type), "duckdb")).toEqual([
      { b: -123 },
      { b: "1180591620717411303424" },
    ]);
  });

  it("reads an unlabelled FixedSizeBinary(16) as UHUGEINT from DuckDB-WASM, as bytes from a table", () => {
    const vector = makeVector(sixteen("0a000000000000000000000000000000"));
    expect(vectorToJson(vector, "duckdb")).toEqual([10]);
    expect(vectorToJson(vector)).toEqual(["0x0a000000000000000000000000000000"]);
  });

  it("refuses an opaque type it cannot read rather than showing its bytes", () => {
    const data = variable("00");
    const read = () => columnToJson(data, 1, opaque("t", data.type, "time_tz"), "duckdb");
    expect(read).toThrow(QueryError);
    expect(read).toThrow(/DuckDB's TIME_TZ values: .* value::VARCHAR/);
    expect(columnToJson(data, 0, opaque("t", data.type, "time_tz"), "duckdb")).toEqual([]);
  });
});
