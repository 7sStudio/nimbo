// DuckDB's values as JSON rows in the page engine, type by type, as DuckDB-WASM really returns them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlEngine } from "./engine.ts";
import { createSqlEngine } from "./page.ts";

let engine: SqlEngine;
beforeAll(async () => {
  engine = createSqlEngine();
  await engine.load();
});
afterAll(() => engine.dispose());

const one = async (sql: string) => (await engine.query(sql)).rows[0];

describe("numbers", () => {
  it("keeps safe BIGINTs as numbers and gives unsafe ones as decimal text", async () => {
    expect(
      await one(
        "SELECT 42::BIGINT AS safe, 9007199254740993::BIGINT AS unsafe, 18446744073709551615::UBIGINT AS top, -7::TINYINT AS tiny",
      ),
    ).toEqual({ safe: 42, unsafe: "9007199254740993", top: "18446744073709551615", tiny: -7 });
  });

  it("reads DECIMAL as a number, keeps NaN and infinities as numbers", async () => {
    expect(
      await one(
        "SELECT 12.50::DECIMAL(10,2) AS d, 'NaN'::DOUBLE AS nan, '-inf'::DOUBLE AS low, 2.5::FLOAT AS f",
      ),
    ).toEqual({ d: 12.5, nan: Number.NaN, low: -Infinity, f: 2.5 });
  });
});

describe("time", () => {
  it("prints DATE, TIMESTAMP, TIMESTAMPTZ and TIME as ISO text", async () => {
    expect(
      await one(
        "SELECT DATE '2026-10-11' AS d, TIMESTAMP '2026-10-11 08:30:00.125' AS ts, TIMESTAMPTZ '2026-10-11 08:30:00+00' AS tz, TIME '12:34:56' AS t, TIME '12:34:56.000250' AS tf",
      ),
    ).toEqual({
      d: "2026-10-11",
      ts: "2026-10-11T08:30:00.125Z",
      tz: "2026-10-11T08:30:00.000Z",
      t: "12:34:56",
      tf: "12:34:56.000250",
    });
  });
});

describe("intervals and infinity", () => {
  it("writes INTERVAL as DuckDB does, and infinite TIMESTAMP and DATE as text", async () => {
    expect(
      await one(
        "SELECT INTERVAL 1 DAY AS i, INTERVAL '1 month 2 days 3 seconds' AS j, NULL::INTERVAL AS n, 'infinity'::TIMESTAMP AS ts, '-infinity'::TIMESTAMP AS nts, 'infinity'::DATE AS d",
      ),
    ).toEqual({
      i: "1 day",
      j: "1 month 2 days 00:00:03",
      n: null,
      ts: "infinity",
      nts: "-infinity",
      d: "infinity",
    });
  });
});

describe("ENUM", () => {
  const abc = "ENUM('a', 'b', 'c')";

  it("refuses ENUM values it cannot label, naming the ::VARCHAR way round", async () => {
    for (const sql of [
      `SELECT 'a'::${abc} AS e`,
      `SELECT ['b'::${abc}] AS le`,
      `SELECT {'e': 'c'::${abc}} AS se`,
    ]) {
      const error = await engine.query(sql).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ name: "QueryError", data: { reason: "query" } });
      expect(String(error)).toContain("::VARCHAR");
    }
    expect(await one(`SELECT ('a'::${abc})::VARCHAR AS e, NULL::${abc} AS n`)).toEqual({
      e: "a",
      n: null,
    });
  });
});

describe("what DuckDB-WASM cannot send (11-query §3)", () => {
  it("gives BIGNUM in a MAP as bytes, where DuckDB-WASM drops the name, and fails on TIME_NS", async () => {
    expect(await one("SELECT MAP {'k': 7::BIGNUM} AS m")).toEqual({ m: { k: "0x80000107" } });
    const error = await engine
      .query("SELECT '12:00:00'::TIME_NS AS t")
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: "QueryError", data: { reason: "query" } });
    expect(String(error)).toContain("TIME_NS");
  });
});

describe("text and bytes", () => {
  it("prints BLOB as hex, keeps UUID and JSON as text", async () => {
    expect(
      await one(
        `SELECT '\\x00\\xFFab'::BLOB AS b, '6f1c3e2a-0000-4000-8000-000000000001'::UUID AS u, '{"a":[1,2]}'::JSON AS j`,
      ),
    ).toEqual({ b: "0x00ff6162", u: "6f1c3e2a-0000-4000-8000-000000000001", j: '{"a":[1,2]}' });
  });
});

describe("nested", () => {
  it("turns STRUCT into objects, LIST and ARRAY into arrays, MAP into objects", async () => {
    expect(
      await one(
        "SELECT {'x': 1, 'y': {'z': 'deep'}} AS s, [1, NULL, 3] AS l, [[1], []] AS ll, [1, 2]::INTEGER[2] AS a, MAP {'k': 1, 'm': 2} AS m, MAP {1: [true]} AS mi, [{'n': 1}] AS ls",
      ),
    ).toEqual({
      s: { x: 1, y: { z: "deep" } },
      l: [1, null, 3],
      ll: [[1], []],
      a: [1, 2],
      m: { k: 1, m: 2 },
      mi: { 1: [true] },
      ls: [{ n: 1 }],
    });
  });

  it("gives a NULL struct, list and map as null", async () => {
    expect(
      await one(
        "SELECT NULL::STRUCT(x INTEGER) AS s, NULL::INTEGER[] AS l, NULL::MAP(VARCHAR, INTEGER) AS m",
      ),
    ).toEqual({ s: null, l: null, m: null });
  });
});

describe("columns", () => {
  it("names repeated columns a, a_1 and keeps both values", async () => {
    const result = await engine.query("SELECT 1 AS a, 2 AS a, 3 AS a_1");
    expect(result.columns.map((column) => column.name)).toEqual(["a", "a_1", "a_1_1"]);
    expect(result.rows).toEqual([{ a: 1, a_1: 2, a_1_1: 3 }]);
  });

  it("reports DuckDB's type names for the result columns", async () => {
    const result = await engine.query(
      "SELECT 1::SMALLINT AS s, 'x' AS v, [1] AS l, {'k': 1} AS st",
    );
    expect(result.columns).toEqual([
      { name: "s", type: "SMALLINT" },
      { name: "v", type: "VARCHAR" },
      { name: "l", type: "INTEGER[]" },
      { name: "st", type: "STRUCT(k INTEGER)" },
    ]);
  });
});
