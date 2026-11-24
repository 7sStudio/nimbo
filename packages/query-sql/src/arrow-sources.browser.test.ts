// Arrow tables in the page engine: one from this copy of apache-arrow goes to DuckDB-WASM as Arrow, one from another
// copy (known by its shape) through its rows; both keep 64-bit integers exact, UBIGINT above INT64_MAX included.
import { Field, List, Struct, Table, Uint64, vectorFromArray } from "apache-arrow";
import { afterAll, beforeAll, expect, it } from "vitest";

import type { SqlEngine, TableSource } from "./engine.ts";
import { createSqlEngine } from "./page.ts";

let engine: SqlEngine;
beforeAll(async () => {
  engine = createSqlEngine();
  await engine.load();
});
afterAll(() => engine.dispose());

it("loads a table from this copy and from another, 64-bit integers exact as BIGINT", async () => {
  const table = new Table({
    i: vectorFromArray(BigInt64Array.from([5n, 9_007_199_254_740_993n])),
    s: vectorFromArray(["a", "b"]),
  });
  const shaped = { schema: table.schema, batches: table.batches, numRows: table.numRows };
  for (const [name, source] of [
    ["native", table],
    ["shaped", shaped as unknown as TableSource],
  ] as const) {
    const schema = await engine.register(name, source);
    expect(schema.columns.map((column) => [column.name, column.type])).toEqual([
      ["i", "BIGINT"],
      ["s", "VARCHAR"],
    ]);
    expect((await engine.query(`SELECT * FROM ${name} ORDER BY i`)).rows).toEqual([
      { i: 5, s: "a" },
      { i: "9007199254740993", s: "b" },
    ]);
  }
});

it("keeps UBIGINT values above INT64_MAX exact from another copy: UBIGINT at the top level, text inside", async () => {
  const table = new Table({
    u: vectorFromArray(BigUint64Array.from([1n, 2n ** 63n, 2n ** 64n - 1n])),
    l: vectorFromArray([[2n ** 63n], [1n], []], new List(new Field("item", new Uint64()))),
    s: vectorFromArray(
      [{ x: 2n ** 64n - 1n }, { x: 1n }, { x: 2n }],
      new Struct([new Field("x", new Uint64())]),
    ),
  });
  const shaped = { schema: table.schema, batches: table.batches, numRows: table.numRows };
  const schema = await engine.register("unsigned", shaped as unknown as TableSource);
  expect(schema.columns.map((column) => column.type)).toEqual([
    "UBIGINT",
    "VARCHAR[]",
    "STRUCT(x VARCHAR)",
  ]);
  expect((await engine.query("SELECT * FROM unsigned ORDER BY u")).rows).toEqual([
    { u: 1, l: ["9223372036854775808"], s: { x: "18446744073709551615" } },
    { u: "9223372036854775808", l: ["1"], s: { x: "1" } },
    { u: "18446744073709551615", l: [], s: { x: "2" } },
  ]);
});
