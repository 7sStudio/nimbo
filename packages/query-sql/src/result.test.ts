// An Arrow batch stream as a capped result: rows up to the limit, the exact total, the deduplicated names.
import type { Table } from "apache-arrow";
import { Field, Int32, RecordBatch, Schema, Struct, makeData, tableFromArrays } from "apache-arrow";
import { describe, expect, it } from "vitest";

import { deadline } from "./abort.ts";
import type { Batches } from "./result.ts";
import { collect } from "./result.ts";

const stream = (table: Table): Batches => {
  const batches = [...table.batches];
  return { schema: table.schema, next: () => Promise.resolve(batches.shift()) };
};

/** 25 rows in three batches of 10, 10 and 5. */
const numbers = () => {
  const one = tableFromArrays({ n: Int32Array.from({ length: 25 }, (_, index) => index) });
  const batch = one.batches[0];
  if (batch === undefined) throw new Error("no batch");
  const parts = [batch.slice(0, 10), batch.slice(10, 20), batch.slice(20, 25)];
  return { schema: one.schema, parts };
};

describe("collect", () => {
  it("converts rows up to the limit and counts the rest exactly", async () => {
    const { schema, parts } = numbers();
    const batches: Batches = { schema, next: () => Promise.resolve(parts.shift()) };
    const result = await collect(batches, 12, deadline(undefined, Infinity), "duckdb");
    expect(result.rows).toHaveLength(12);
    expect(result.rows[11]).toEqual({ n: 11 });
    expect(result).toMatchObject({
      total: 25,
      truncated: true,
      columns: [{ name: "n", type: "INTEGER" }],
    });
  });

  it("is not truncated under the cap, and a limit of 0 only counts", async () => {
    const table = tableFromArrays({ n: Int32Array.from([1, 2, 3]) });
    expect(await collect(stream(table), 10, deadline(undefined, Infinity), "duckdb")).toMatchObject(
      {
        rows: [{ n: 1 }, { n: 2 }, { n: 3 }],
        total: 3,
        truncated: false,
      },
    );
    expect(await collect(stream(table), 0, deadline(undefined, Infinity), "duckdb")).toMatchObject({
      rows: [],
      total: 3,
      truncated: true,
    });
  });
});

describe("collect edges", () => {
  it("names repeated columns a, a_1 so each row keeps every value", async () => {
    const data = makeData({ type: new Int32(), data: Int32Array.from([1]) });
    const schema = new Schema([new Field("a", new Int32()), new Field("a", new Int32())]);
    const struct = makeData({
      type: new Struct(schema.fields),
      length: 1,
      nullCount: 0,
      children: [data, data],
    });
    const batch = new RecordBatch(schema, struct);
    const batches = [batch];
    const result = await collect(
      { schema, next: () => Promise.resolve(batches.shift()) },
      5,
      deadline(undefined, Infinity),
      "duckdb",
    );
    expect(result.columns.map((column) => column.name)).toEqual(["a", "a_1"]);
    expect(result.rows).toEqual([{ a: 1, a_1: 1 }]);
  });

  it("stops with the deadline's error between batches", async () => {
    const { schema, parts } = numbers();
    const caller = new AbortController();
    const batches: Batches = {
      schema,
      next: () => {
        caller.abort();
        return Promise.resolve(parts.shift());
      },
    };
    await expect(
      collect(batches, 100, deadline(caller.signal, Infinity), "duckdb"),
    ).rejects.toMatchObject({
      data: { reason: "cancelled" },
    });
  });
});
