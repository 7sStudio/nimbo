// The daemon's engine on a real native DuckDB: sources, aliases, names that differ in case, schema, the row cap,
// errors with positions, exports, and no file left in its directory but its spill folder, made at open and empty.
// Every test registers what it asserts on.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { tableFromJSON } from "apache-arrow";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlEngine } from "../engine.ts";
import { widePositions } from "../fixtures/positions.ts";
import { createNodeSqlEngine } from "./engine.ts";

let workspace: string;
let directory: string;
let engine: SqlEngine;
beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "nimbo-query-sql-"));
  directory = join(workspace, ".jsnb", "cache", "sql");
  engine = createNodeSqlEngine({ directory, maxRows: 2 });
  await engine.load();
});
afterAll(async () => {
  await engine.dispose();
  await rm(workspace, { recursive: true, force: true });
});

const rows = [
  { id: 1, type: "charge", data: { object: { amount: 500 } } },
  { id: 2, type: "refund", data: { object: { amount: 120 } } },
  { id: 3, type: "charge", data: { object: { amount: 900 } } },
];

const count = async (table: string) =>
  (await engine.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0]?.n;

describe("register on Node", () => {
  it("creates its directory, loads rows with their STRUCT fields, and leaves no file behind", async () => {
    const schema = await engine.register("struct_t", rows, { alias: "struct_events" });
    expect(schema).toMatchObject({ table: "struct_t", alias: "struct_events", rowCount: 3 });
    expect(schema.columns[2]).toEqual({
      name: "data",
      type: 'STRUCT("object" STRUCT("amount" BIGINT))',
      fields: [
        {
          name: "object",
          type: 'STRUCT("amount" BIGINT)',
          fields: [{ name: "amount", type: "BIGINT", fields: [] }],
        },
      ],
    });
    expect(await readdir(directory, { recursive: true })).toEqual(["__jsnb_temp"]); // its spill folder, empty
  });

  it("loads a Blob and an Arrow table", async () => {
    await engine.register("from_blob", new Blob([JSON.stringify(rows)]));
    await engine.register(
      "from_arrow",
      tableFromJSON([
        { n: 1, s: "x" },
        { n: 2, s: "y" },
      ]),
    );
    expect(await count("from_blob")).toBe(3);
    expect((await engine.query("SELECT s FROM from_arrow ORDER BY n")).rows).toEqual([
      { s: "x" },
      { s: "y" },
    ]);
    expect(await readdir(directory, { recursive: true })).toEqual(["__jsnb_temp"]); // its spill folder, empty
  });
});

describe("aliases, case and drop on Node", () => {
  it("moves and drops aliases, and drops tables", async () => {
    await engine.register("first_t", rows, { alias: "moving" });
    await engine.register("second_t", rows.slice(0, 1), { alias: "moving" });
    expect(await count("moving")).toBe(1);
    await engine.drop("second_t");
    await expect(engine.query("SELECT * FROM moving")).rejects.toMatchObject({
      data: { reason: "query" },
    });
    await expect(engine.register("bad_t", [{ big: 1n }])).rejects.toMatchObject({
      data: { reason: "input" },
    });
  });

  it("treats names that differ only in case as one, like DuckDB", async () => {
    expect((await engine.register("case_t", rows, { alias: "CASE_T" })).alias).toBeUndefined();
    await engine.register("Case_T", rows.slice(0, 2));
    expect(await count("case_t")).toBe(2);
    await expect(engine.register("other_t", rows, { alias: "case_T" })).rejects.toMatchObject({
      data: { reason: "input" },
    });
    await engine.drop("CASE_T");
    await expect(engine.query("SELECT * FROM case_t")).rejects.toMatchObject({
      data: { reason: "query" },
    });
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

describe("query on Node", () => {
  it("caps at maxRows with the exact total", async () => {
    await engine.register("capped_t", rows);
    const result = await engine.query("SELECT id FROM capped_t ORDER BY id");
    expect(result).toMatchObject({ rows: [{ id: 1 }, { id: 2 }], total: 3, truncated: true });
    expect(result.columns).toEqual([{ name: "id", type: "BIGINT" }]);
    expect(await engine.query("SELECT id FROM capped_t", { limit: 5 })).toMatchObject({
      truncated: false,
    });
  });

  it("underlines syntax, binder and catalog errors like the page", async () => {
    await engine.register("errors_t", rows);
    const cases: [string, string][] = [
      ["SELECT * FORM errors_t", "errors_t"],
      ["SELECT id\n  , nope\nFROM errors_t", "nope"],
      ["SELECT * FROM nowhere", "nowhere"],
    ];
    for (const [sql, word] of cases) {
      const error = await engine.query(sql).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ data: { reason: "query" }, position: sql.lastIndexOf(word) });
      expect(String(error)).not.toContain("LINE ");
    }
  });
});

describe("positions on Node after characters outside ASCII", () => {
  it("are exact after é, ü and an emoji, and absent after wide CJK text, like the page", async () => {
    for (const { sql, position } of widePositions) {
      const error = await engine.query(sql).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ data: { reason: "query" } });
      expect(error).toHaveProperty("position", position);
    }
  });
});

describe("ENUM on Node", () => {
  it("reads ENUM labels at the top level, in a LIST and in a STRUCT", async () => {
    const abc = "ENUM('a', 'b', 'c')";
    const result = await engine.query(
      `SELECT 'a'::${abc} AS e, ['b'::${abc}, NULL, 'c'::${abc}] AS le, {'e': 'c'::${abc}} AS se`,
    );
    expect(result.rows).toEqual([{ e: "a", le: ["b", null, "c"], se: { e: "c" } }]);
  });
});

describe("exportAll on Node", () => {
  it("writes CSV and NDJSON past the cap and removes its file", async () => {
    await engine.register("export_t", rows);
    const csv = await engine.exportAll("SELECT id, type FROM export_t ORDER BY id;", {
      format: "csv",
    });
    expect([csv.type, await csv.text()]).toEqual([
      "text/csv",
      "id,type\n1,charge\n2,refund\n3,charge\n",
    ]);
    const ndjson = await engine.exportAll("SELECT id FROM export_t ORDER BY id -- all", {
      format: "ndjson",
    });
    expect(await ndjson.text()).toBe('{"id":1}\n{"id":2}\n{"id":3}\n');
    const error = await engine
      .exportAll("SELECT * FORM export_t", { format: "csv" })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ data: { reason: "query" }, position: 14 });
    expect(await readdir(directory, { recursive: true })).toEqual(["__jsnb_temp"]); // its spill folder, empty
  });
});
