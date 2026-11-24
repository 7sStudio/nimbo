// Registering tables in the page engine: the three sources, the alias view, re-registration, names that differ in
// case, drop, schema and bad input. Every test registers the tables it asserts on.
import { tableFromJSON } from "apache-arrow";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlEngine } from "./engine.ts";
import { createSqlEngine } from "./page.ts";

let engine: SqlEngine;
beforeAll(async () => {
  engine = createSqlEngine();
  await engine.load();
});
afterAll(() => engine.dispose());

const rows = [
  { id: 1, type: "charge", amount: 500 },
  { id: 2, type: "refund", amount: 120 },
  { id: 3, type: "charge", amount: 900 },
];

const count = async (table: string) =>
  (await engine.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0]?.n;

describe("register sources", () => {
  it("loads rows and returns the table's schema", async () => {
    expect(await engine.register("rows_t", rows)).toEqual({
      table: "rows_t",
      alias: undefined,
      rowCount: 3,
      columns: [
        { name: "id", type: "BIGINT", fields: [] },
        { name: "type", type: "VARCHAR", fields: [] },
        { name: "amount", type: "BIGINT", fields: [] },
      ],
    });
  });

  it("streams a Blob of JSON through a file handle", async () => {
    await engine.register("blob_t", new Blob([JSON.stringify(rows)], { type: "application/json" }));
    const charges = await engine.query("SELECT type FROM blob_t WHERE amount > 200 ORDER BY id");
    expect(charges.rows).toEqual([{ type: "charge" }, { type: "charge" }]);
  });

  it("copies an Arrow table through a staging table it drops after", async () => {
    const schema = await engine.register("arrow_t", tableFromJSON(rows));
    expect(schema.columns.map((column) => column.name)).toEqual(["id", "type", "amount"]);
    const types = await engine.query("SELECT type FROM arrow_t ORDER BY id");
    expect(types.rows.map((row) => row.type)).toEqual(["charge", "refund", "charge"]);
    const tables = await engine.query("SELECT table_name FROM duckdb_tables()");
    expect(tables.rows.map((row) => row.table_name)).not.toContainEqual(
      expect.stringMatching(/^__jsnb_/u),
    );
  });

  it("replaces a table registered again under the same name", async () => {
    await engine.register("again_t", rows);
    await engine.register("again_t", rows.slice(0, 1));
    expect(await count("again_t")).toBe(1);
  });
});

describe("register aliases", () => {
  it("answers under the binding name too", async () => {
    expect((await engine.register("alias_t", rows, { alias: "alias_events" })).alias).toBe(
      "alias_events",
    );
    expect(await count("alias_events")).toBe(3);
    expect((await engine.schema("alias_t")).alias).toBe("alias_events");
  });

  it("drops the old alias when the table is registered again without it", async () => {
    await engine.register("gone_alias_t", rows, { alias: "gone_alias" });
    await engine.register("gone_alias_t", rows);
    await expect(engine.query("SELECT * FROM gone_alias")).rejects.toMatchObject({
      data: { reason: "query" },
    });
  });

  it("moves an alias to the table registered with it last", async () => {
    await engine.register("first_t", rows, { alias: "moving" });
    await engine.register("second_t", rows.slice(0, 1), { alias: "moving" });
    expect(await count("moving")).toBe(1);
    expect((await engine.schema("first_t")).alias).toBeUndefined();
  });
});

describe("names and case", () => {
  it("ignores an alias equal to the table name, in any case", async () => {
    expect((await engine.register("same_t", rows, { alias: "same_t" })).alias).toBeUndefined();
    expect((await engine.register("case_t", rows, { alias: "CASE_T" })).alias).toBeUndefined();
  });

  it("replaces and drops a table through a name that differs only in case", async () => {
    await engine.register("events_c", rows);
    await engine.register("Events_C", rows.slice(0, 2));
    expect(await count("events_c")).toBe(2);
    await engine.drop("EVENTS_C");
    await expect(engine.query("SELECT * FROM events_c")).rejects.toMatchObject({
      data: { reason: "query" },
    });
  });

  it("refuses names that clash with another table or alias, ignoring case", async () => {
    await engine.register("clash_t", rows, { alias: "clash_alias" });
    await expect(engine.register("CLASH_ALIAS", rows)).rejects.toMatchObject({
      data: { reason: "input" },
    });
    await expect(engine.register("clash_u", rows, { alias: "Clash_T" })).rejects.toMatchObject({
      data: { reason: "input" },
    });
  });
});

describe("drop and failed registrations", () => {
  it("drops the table and its alias view", async () => {
    await engine.register("drop_t", rows, { alias: "drop_alias" });
    await engine.drop("drop_t");
    for (const name of ["drop_t", "drop_alias"]) {
      await expect(engine.query(`SELECT * FROM ${name}`)).rejects.toMatchObject({
        data: { reason: "query" },
      });
    }
    await engine.drop("drop_t");
  });

  it("leaves DuckDB and the record as they were when DuckDB refuses part of a registration", async () => {
    await engine.query("CREATE OR REPLACE TABLE occupied (x INTEGER)");
    await engine.register("kept_t", rows.slice(0, 1));
    await expect(engine.register("kept_t", rows, { alias: "occupied" })).rejects.toMatchObject({
      data: { reason: "query" },
    });
    expect(await count("kept_t")).toBe(1);
    expect((await engine.schema("kept_t")).alias).toBeUndefined();
  });
});

describe("register input", () => {
  it("refuses bad names, rows JSON cannot encode and unknown sources", async () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const failures = [
      () => engine.register("", rows),
      () => engine.register("input_t", rows, { alias: "x\0y" }),
      () => engine.register("input_t", [{ big: 2n }]),
      () => engine.register("input_t", [cycle]),
      () => engine.register("input_t", new Map() as unknown as Blob),
      () => engine.schema("__jsnb_load_1"),
      () => engine.drop("a".repeat(129)),
    ];
    for (const failure of failures) {
      await expect(failure()).rejects.toMatchObject({
        name: "QueryError",
        data: { reason: "input" },
      });
    }
  });

  it("reports a missing table as DuckDB's catalog error", async () => {
    await expect(engine.schema("missing")).rejects.toMatchObject({
      data: { reason: "query" },
      message: expect.stringContaining("missing") as unknown,
    });
  });
});
