// An Arrow table as the JSON text the engines load: 64-bit integers beyond 2^53 as bare number literals at any depth
// (top level, LIST, STRUCT, MAP value, dictionary), except a UBIGINT field holding a value above INT64_MAX, all text.
import {
  Dictionary,
  Field,
  Int32,
  Int64,
  List,
  Struct,
  Table,
  Uint64,
  Utf8,
  vectorFromArray,
} from "apache-arrow";
import { describe, expect, it } from "vitest";

import { mapOf } from "./fixtures/arrow-types.ts";
import { tableJson } from "./table-json.ts";

const wide = 9_007_199_254_740_993n;

/** The JSON with its bare number literals of 16 digits or more quoted, so JSON.parse keeps them exact. */
const quoteBare = (json: string) => json.replaceAll(/(?<=[:,[])\d{16,}/g, '"$&"');

describe("tableJson", () => {
  it("writes 64-bit integers beyond 2^53 as number literals, at any depth", () => {
    const struct = new Struct([new Field("x", new Int64())]);
    const table = new Table({
      i: vectorFromArray([wide, 5n, null], new Int64()),
      l: vectorFromArray([[wide, null], [], null], new List(new Field("item", new Int64()))),
      s: vectorFromArray([{ x: wide }, { x: 1n }, null], struct),
      m: vectorFromArray([new Map([["k", wide]]), null, null], mapOf(new Utf8(), new Int64())),
      d: vectorFromArray(["a", "b", "a"], new Dictionary(new Utf8(), new Int32())),
    });
    const { json, unsigned } = tableJson(table);
    expect(JSON.parse(quoteBare(json))).toEqual([
      {
        i: "9007199254740993",
        l: ["9007199254740993", null],
        s: { x: "9007199254740993" },
        m: { k: "9007199254740993" },
        d: "a",
      },
      { i: 5, l: [], s: { x: 1 }, m: null, d: "b" },
      { i: null, l: null, s: null, m: null, d: "a" },
    ]);
    expect(json).toContain('"i":9007199254740993,"l":[9007199254740993,null]');
    expect(unsigned).toEqual([]);
  });
});

describe("tableJson above INT64_MAX", () => {
  it("writes a UBIGINT field holding a value above INT64_MAX as text, every value of it", () => {
    const table = new Table({
      u: vectorFromArray([2n ** 64n - 1n, 0n, null], new Uint64()),
      lu: vectorFromArray([[2n ** 63n, 1n], [], null], new List(new Field("item", new Uint64()))),
      small: vectorFromArray([1n, 2n, wide], new Uint64()),
    });
    const { json, unsigned } = tableJson(table);
    expect(JSON.parse(quoteBare(json))).toEqual([
      { u: "18446744073709551615", lu: ["9223372036854775808", "1"], small: 1 },
      { u: "0", lu: [], small: 2 },
      { u: null, lu: null, small: "9007199254740993" },
    ]);
    expect(json).toContain('"small":9007199254740993');
    expect(unsigned).toEqual(["u"]);
  });
});
