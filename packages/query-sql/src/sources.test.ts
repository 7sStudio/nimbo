// Table sources by kind, and rows as the JSON text DuckDB reads.
import { Table, Type, tableFromArrays } from "apache-arrow";
import { describe, expect, it } from "vitest";

import type { TableSource } from "./engine.ts";
import { classify, encodeRows, encodeTable } from "./sources.ts";

describe("classify", () => {
  it("tells rows, a Blob and an Arrow table apart", () => {
    expect(classify("t", [{ a: 1 }])).toMatchObject({ ok: true, value: { kind: "rows" } });
    expect(classify("t", new Blob(["[]"]))).toMatchObject({ ok: true, value: { kind: "blob" } });
    expect(classify("t", tableFromArrays({ a: Int32Array.from([1]) }))).toMatchObject({
      ok: true,
      value: { kind: "arrow", native: true },
    });
  });

  it("refuses anything else as input", () => {
    const untyped = { schema: { fields: [{ name: "a", type: {} }] }, batches: [], numRows: 0 };
    for (const source of [{ rows: [] }, { schema: { fields: [] }, numRows: 0 }, untyped, null]) {
      expect(classify("t", source as unknown as TableSource)).toMatchObject({
        ok: false,
        error: { data: { reason: "input" } },
      });
    }
  });
});

describe("classify a table from another copy of apache-arrow", () => {
  it("reads a table from another copy of apache-arrow, known by its shape, through its rows", () => {
    const real = tableFromArrays({ a: Int32Array.from([1, 2]), s: ["x", "y"] });
    const shaped = { schema: real.schema, batches: real.batches, numRows: real.numRows };
    expect(shaped instanceof Table).toBe(false);
    expect(classify("t", shaped as unknown as TableSource)).toEqual({
      ok: true,
      value: { kind: "arrow", table: shaped, native: false },
    });
    expect(encodeTable("t", shaped as unknown as Table)).toEqual({
      ok: true,
      value: { json: '[{"a":1,"s":"x"},{"a":2,"s":"y"}]', unsigned: [] },
    });
    for (const rows of [[shaped], Object.assign([], { schema: real.schema })]) {
      expect(classify("t", rows)).toMatchObject({ ok: true, value: { kind: "rows", rows } });
    }
    const blob = Object.assign(new Blob(["[]"]), { schema: real.schema, batches: [], numRows: 0 });
    expect(classify("t", blob)).toMatchObject({ ok: true, value: { kind: "blob", blob } });
  });

  it("refuses such a table as input when a column cannot be read through it", () => {
    const type = { typeId: Type.Duration, unit: 0 };
    const fields = [{ name: "d", type, metadata: new Map() }];
    const data = { type, length: 1, offset: 0, nullCount: 0, values: BigInt64Array.from([1n]) };
    const batch = { schema: { fields }, numRows: 1, data: { children: [data] } };
    const shaped = { schema: { fields }, batches: [batch], numRows: 1 };
    const outcome = encodeTable("events", shaped as unknown as Table);
    expect(outcome).toMatchObject({ ok: false, error: { data: { reason: "input" } } });
    expect(outcome.ok ? "" : outcome.error.message).toContain('"events"');
  });
});

describe("encodeRows", () => {
  it("stringifies rows", () => {
    expect(encodeRows("t", [{ a: 1 }, null])).toEqual({ ok: true, value: '[{"a":1},null]' });
  });

  it("refuses a BigInt and a cycle as input naming the table", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const rows of [[{ big: 1n }], [cycle]]) {
      const outcome = encodeRows("events", rows);
      expect(outcome).toMatchObject({ ok: false, error: { data: { reason: "input" } } });
      expect(outcome.ok ? "" : outcome.error.message).toContain('"events"');
    }
  });
});
