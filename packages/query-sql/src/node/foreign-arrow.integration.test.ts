// Arrow tables on the daemon, from this copy of apache-arrow and from a second one (its CommonJS build, as a host
// bundling its own would have): registered through their rows, 64-bit integers exact, refused as input when a column
// cannot be read that way.
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as ours from "apache-arrow";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlEngine } from "../engine.ts";
import { createNodeSqlEngine } from "./engine.ts";

const require = createRequire(import.meta.url);
/** The CommonJS build: the same version, but its own classes, so `instanceof` against ours fails. */
const other = require("apache-arrow") as typeof ours;

let directory: string;
let engine: SqlEngine;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "nimbo-query-sql-"));
  engine = createNodeSqlEngine({ directory });
});
afterAll(async () => {
  await engine.dispose();
  await rm(directory, { recursive: true, force: true });
});

describe("an Arrow table from another apache-arrow copy", () => {
  it("registers through its rows, a BIGINT and a STRUCT included", async () => {
    const struct = new other.Struct([new other.Field("x", new other.Int32())]);
    const table = new other.Table({
      n: other.vectorFromArray(Int32Array.from([1, 2])),
      s: other.vectorFromArray(["a", "b"]),
      big: other.vectorFromArray(BigInt64Array.from([5n, 6n])),
      st: other.vectorFromArray([{ x: 1 }, { x: 2 }], struct),
    });
    expect(table instanceof ours.Table).toBe(false);
    await engine.register("t", table);
    expect((await engine.query("SELECT * FROM t ORDER BY n")).rows).toEqual([
      { n: 1, s: "a", big: 5, st: { x: 1 } },
      { n: 2, s: "b", big: 6, st: { x: 2 } },
    ]);
  });

  it("refuses it as input when a column cannot be read through it", async () => {
    const durations = other.vectorFromArray([5n], new other.DurationSecond());
    const table = new other.Table({ d: durations });
    const registering = engine.register("d", table);
    await expect(registering).rejects.toMatchObject({ data: { reason: "input" } });
  });
});

describe("64-bit integers in an Arrow table", () => {
  for (const [copy, arrow] of [
    ["this", ours],
    ["another", other],
  ] as const) {
    it(`keeps Int64 and Uint64 exact as BIGINT, from ${copy} copy of apache-arrow`, async () => {
      const wide = [5n, 9_007_199_254_740_993n];
      const list = new arrow.List(new arrow.Field("item", new arrow.Int64()));
      const table = new arrow.Table({
        i: arrow.vectorFromArray(BigInt64Array.from(wide)),
        u: arrow.vectorFromArray(BigUint64Array.from(wide)),
        l: arrow.vectorFromArray([[9_007_199_254_740_993n], [5n]], list),
      });
      const schema = await engine.register(`wide_${copy}`, table);
      expect(schema.columns.map((column) => column.type)).toEqual(["BIGINT", "BIGINT", "BIGINT[]"]);
      expect((await engine.query(`SELECT * FROM wide_${copy} ORDER BY i`)).rows).toEqual([
        { i: 5, u: 5, l: ["9007199254740993"] },
        { i: "9007199254740993", u: "9007199254740993", l: [5] },
      ]);
    });
  }
});

describe("UBIGINT values above INT64_MAX in an Arrow table", () => {
  for (const [copy, arrow] of [
    ["this", ours],
    ["another", other],
  ] as const) {
    it(`keeps them exact from ${copy} copy: UBIGINT at the top level, text inside`, async () => {
      const list = new arrow.List(new arrow.Field("item", new arrow.Uint64()));
      const struct = new arrow.Struct([new arrow.Field("x", new arrow.Uint64())]);
      const table = new arrow.Table({
        u: arrow.vectorFromArray(BigUint64Array.from([1n, 2n ** 63n, 2n ** 64n - 1n])),
        l: arrow.vectorFromArray([[2n ** 63n], [1n], []], list),
        s: arrow.vectorFromArray([{ x: 2n ** 64n - 1n }, { x: 1n }, { x: 2n }], struct),
      });
      const schema = await engine.register(`unsigned_${copy}`, table);
      const types = schema.columns.map((column) => column.type);
      expect(types).toEqual(["UBIGINT", "VARCHAR[]", 'STRUCT("x" VARCHAR)']);
      expect((await engine.query(`SELECT * FROM unsigned_${copy} ORDER BY u`)).rows).toEqual([
        { u: 1, l: ["9223372036854775808"], s: { x: "18446744073709551615" } },
        { u: "9223372036854775808", l: ["1"], s: { x: "1" } },
        { u: "18446744073709551615", l: [], s: { x: "2" } },
      ]);
    });
  }
});
