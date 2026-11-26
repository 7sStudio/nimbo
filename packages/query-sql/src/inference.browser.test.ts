// What read_json_auto infers from rows: nested objects, arrays, nulls, mixed types, dates, wide
// numbers; and its edge cases: no rows, one row, 100 000 rows.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Column, SqlEngine } from "./engine.ts";
import { createSqlEngine } from "./page.ts";

let engine: SqlEngine;
beforeAll(async () => {
  engine = createSqlEngine();
  await engine.load();
});
afterAll(() => engine.dispose());

const typeOf = (columns: readonly Column[], name: string) =>
  columns.find((column) => column.name === name)?.type;

describe("schema inference", () => {
  it("makes nested objects STRUCTs with their members as fields", async () => {
    const schema = await engine.register("nested", [
      { data: { object: { id: "ch_1", amount: 500, metadata: { plan: "pro" } } } },
      { data: { object: { id: "ch_2", amount: 900, metadata: { plan: "team" } } } },
    ]);
    const data = schema.columns[0];
    expect(data?.type).toBe(
      "STRUCT(object STRUCT(id VARCHAR, amount BIGINT, metadata STRUCT(plan VARCHAR)))",
    );
    const object = data?.fields[0];
    expect(object?.fields.map((field) => `${field.name} ${field.type}`)).toEqual([
      "id VARCHAR",
      "amount BIGINT",
      "metadata STRUCT(plan VARCHAR)",
    ]);
    const amounts = await engine.query("SELECT data.object.amount AS a FROM nested ORDER BY a");
    expect(amounts.rows).toEqual([{ a: 500 }, { a: 900 }]);
  });

  it("makes arrays LISTs, with STRUCT elements reachable as fields", async () => {
    const schema = await engine.register("lists", [
      { tags: ["a", "b"], lines: [{ amount: 1 }] },
      { tags: [], lines: [] },
    ]);
    expect(typeOf(schema.columns, "tags")).toBe("VARCHAR[]");
    expect(typeOf(schema.columns, "lines")).toBe("STRUCT(amount BIGINT)[]");
    expect(schema.columns[1]?.fields).toEqual([{ name: "amount", type: "BIGINT", fields: [] }]);
  });
});

describe("schema inference of nulls and mixed types", () => {
  it("keeps nulls, makes mixed types and all-null columns JSON (read back as text)", async () => {
    const schema = await engine.register("mixed", [
      { id: 1, maybe: "x", mixed: 1, nothing: null },
      { id: 2, maybe: null, mixed: "a", nothing: null },
      { id: 3, mixed: { k: true }, nothing: null },
    ]);
    expect(typeOf(schema.columns, "maybe")).toBe("VARCHAR");
    expect(typeOf(schema.columns, "mixed")).toBe("VARCHAR");
    const rows = (await engine.query("SELECT maybe, mixed, nothing FROM mixed ORDER BY id")).rows;
    expect(rows).toEqual([
      { maybe: "x", mixed: "1", nothing: null },
      { maybe: null, mixed: '"a"', nothing: null },
      { maybe: null, mixed: '{"k":true}', nothing: null },
    ]);
  });
});

describe("schema inference of text and numbers", () => {
  it("reads ISO timestamps (as toISOString writes them) and dates as TIMESTAMP and DATE", async () => {
    const schema = await engine.register("times", [
      { seen: "2026-10-11T08:30:00.125Z", day: "2026-10-11" },
      { seen: "2026-10-12T00:00:00.000Z", day: "2026-10-12" },
    ]);
    expect(typeOf(schema.columns, "seen")).toBe("TIMESTAMP");
    expect(typeOf(schema.columns, "day")).toBe("DATE");
    const first = (await engine.query("SELECT seen, day FROM times ORDER BY seen LIMIT 1")).rows[0];
    expect(first).toEqual({ seen: "2026-10-11T08:30:00.125Z", day: "2026-10-11" });
  });

  it("keeps other timestamp styles as text instead of failing the load", async () => {
    const schema = await engine.register("styles", [
      {
        iso: "2026-10-11T08:30:00.125Z",
        spaced: "2026-10-11 08:30:00",
        zoned: "2026-10-11T08:30:00+02:00",
      },
    ]);
    expect(schema.columns.map((column) => column.type)).toEqual([
      "TIMESTAMP",
      "VARCHAR",
      "VARCHAR",
    ]);
  });
});

describe("schema inference of numbers", () => {
  it("widens numbers that need it to DOUBLE", async () => {
    const schema = await engine.register("numbers", [{ n: 1 }, { n: 1.5 }, { n: 1e20 }]);
    expect(typeOf(schema.columns, "n")).toBe("DOUBLE");
  });

  it("scans every row, so a type change after row 20 480 does not fail", async () => {
    const rows: unknown[] = Array.from({ length: 30_000 }, (_, index) => ({ v: index }));
    rows.push({ v: "late text" });
    const schema = await engine.register("late", rows);
    expect(typeOf(schema.columns, "v")).toBe("VARCHAR");
    expect(schema.rowCount).toBe(30_001);
  });
});

describe("read_json_auto edge cases", () => {
  it("registers an empty array as one JSON column with no rows, and queries work", async () => {
    const schema = await engine.register("empty", []);
    expect(schema).toMatchObject({ rowCount: 0, columns: [{ name: "json" }] });
    expect(await engine.query("SELECT count(*) AS n FROM empty")).toMatchObject({
      rows: [{ n: 0 }],
    });
    expect(await engine.query("SELECT * FROM empty")).toMatchObject({
      rows: [],
      total: 0,
      truncated: false,
    });
  });

  it("registers one row", async () => {
    const schema = await engine.register("one", [{ id: "evt_1", amount: 1 }]);
    expect(schema.rowCount).toBe(1);
    expect((await engine.query("SELECT * FROM one")).rows).toEqual([{ id: "evt_1", amount: 1 }]);
  });
});

describe("read_json_auto sizes", () => {
  it("registers 100 000 rows and aggregates them", async () => {
    const rows = Array.from({ length: 100_000 }, (_, index) => ({
      i: index,
      even: index % 2 === 0,
    }));
    const schema = await engine.register("many", rows);
    expect(schema.rowCount).toBe(100_000);
    const result = await engine.query(
      "SELECT even, count(*) AS n, sum(i) AS s FROM many GROUP BY 1 ORDER BY 1",
    );
    expect(result.rows).toEqual([
      { even: false, n: 50_000, s: 2_500_000_000 },
      { even: true, n: 50_000, s: 2_499_950_000 },
    ]);
  });

  it("registers an array of numbers or of arrays as one column named value, as unnest names it", async () => {
    expect((await engine.register("scalars", [1, 2, 3])).columns).toEqual([
      { name: "value", type: "BIGINT", fields: [] },
    ]);
    expect(
      (await engine.query("SELECT sum(value) AS s FROM scalars WHERE value > 1")).rows,
    ).toEqual([{ s: 5 }]);
    expect((await engine.register("pairs", [[1, 2], [3]])).columns).toEqual([
      { name: "value", type: "BIGINT[]", fields: [] },
    ]);
    // a list with a record in it stays as read_json_auto reads it
    expect(
      (await engine.register("mixed", [{ a: 1 }, 2])).columns.map((c) => c.name),
    ).not.toContain("value");
  });
});
