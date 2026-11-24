// Queries in the page engine: the row cap with an exact total, DuckDB's errors with their position, export via COPY.
// Every test registers the rows it queries.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlEngine } from "./engine.ts";
import { widePositions } from "./fixtures/positions.ts";
import { createSqlEngine } from "./page.ts";

let engine: SqlEngine;
beforeAll(async () => {
  engine = createSqlEngine({ maxRows: 50 });
  await engine.load();
});
afterAll(() => engine.dispose());

/** Registers the 120 rows the tests query, as `t` with the alias `numbers`. */
const numbers = () =>
  engine.register(
    "t",
    Array.from({ length: 120 }, (_, index) => ({ i: index, s: `x${String(index)}` })),
    { alias: "numbers" },
  );

describe("row cap", () => {
  it("caps at maxRows by default and counts the exact total", async () => {
    await numbers();
    const result = await engine.query("SELECT * FROM t ORDER BY i");
    expect(result).toMatchObject({ total: 120, truncated: true });
    expect(result.rows).toHaveLength(50);
    expect(result.rows[49]).toEqual({ i: 49, s: "x49" });
    expect(result.columns).toEqual([
      { name: "i", type: "BIGINT" },
      { name: "s", type: "VARCHAR" },
    ]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("caps at the query's limit when given", async () => {
    await numbers();
    const result = await engine.query("SELECT i FROM numbers", { limit: 7 });
    expect(result).toMatchObject({ total: 120, truncated: true });
    expect(result.rows).toHaveLength(7);
    expect(await engine.query("SELECT i FROM t", { limit: 0 })).toMatchObject({
      rows: [],
      total: 120,
    });
  });

  it("is not truncated under the cap", async () => {
    await numbers();
    const result = await engine.query("SELECT i FROM t WHERE i < 3 ORDER BY i");
    expect(result).toMatchObject({
      rows: [{ i: 0 }, { i: 1 }, { i: 2 }],
      total: 3,
      truncated: false,
    });
  });

  it("refuses a limit that is not a whole number", async () => {
    await numbers();
    await expect(engine.query("SELECT 1", { limit: -2 })).rejects.toMatchObject({
      data: { reason: "input" },
    });
  });
});

describe("errors", () => {
  it("underlines a syntax error on one line", async () => {
    await numbers();
    const error = await engine.query("SELECT * FORM t").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: "QueryError", data: { reason: "query" }, position: 14 });
    expect(error).toHaveProperty("message", 'Parser Error: syntax error at or near "t"');
  });

  it("underlines a binder error on the second line", async () => {
    await numbers();
    const sql = "SELECT i\n  , nope\nFROM t";
    const error = await engine.query(sql).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ data: { reason: "query" }, position: sql.indexOf("nope") });
    expect(String(error)).toContain('Referenced column "nope" not found');
    expect(String(error)).not.toContain("LINE 2");
  });

  it("underlines the mistake in a long line DuckDB shows shortened", async () => {
    await numbers();
    const sql = `SELECT ${Array.from({ length: 40 }, (_, index) => `i AS c${String(index)}`).join(", ")}, missing FROM t`;
    const error = await engine.query(sql).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ data: { reason: "query" }, position: sql.indexOf("missing") });
  });

  it("names a missing table", async () => {
    await numbers();
    const error = await engine.query("SELECT * FROM nowhere").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ data: { reason: "query" }, position: 14 });
    expect(String(error)).toContain("Catalog Error: Table with name nowhere does not exist");
  });
});

describe("positions after characters outside ASCII", () => {
  it("are exact after é, ü and an emoji, and absent after wide CJK text", async () => {
    for (const { sql, position } of widePositions) {
      const error = await engine.query(sql).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ data: { reason: "query" } });
      expect(error).toHaveProperty("position", position);
    }
  });
});

describe("exportAll", () => {
  it("writes every row of a filtered query as CSV with a header", async () => {
    await numbers();
    const csv = await engine.exportAll("SELECT i, s FROM t WHERE i >= 118 ORDER BY i;", {
      format: "csv",
    });
    expect(csv.type).toBe("text/csv");
    expect(await csv.text()).toBe("i,s\n118,x118\n119,x119\n");
  });

  it("writes NDJSON past the row cap, and tolerates a trailing comment", async () => {
    await numbers();
    const ndjson = await engine.exportAll("SELECT i FROM numbers ORDER BY i -- all of them", {
      format: "ndjson",
    });
    expect(ndjson.type).toBe("application/x-ndjson");
    const lines = (await ndjson.text()).trim().split("\n");
    expect(lines).toHaveLength(120);
    expect(lines[0]).toBe('{"i":0}');
  });

  it("underlines a mistake at its place in the user's SQL, not in the COPY around it", async () => {
    await numbers();
    const error = await engine
      .exportAll("SELECT * FORM t", { format: "csv" })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ data: { reason: "query" }, position: 14 });
  });

  it("refuses an unknown format", async () => {
    await numbers();
    const format = "xml" as "csv";
    await expect(engine.exportAll("SELECT 1", { format })).rejects.toMatchObject({
      data: { reason: "input" },
    });
  });
});
