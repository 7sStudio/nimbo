// The daemon's DuckDB stays inside its directory (09 §5: the daemon writes only inside the workspace): user SQL can
// neither read nor write a file elsewhere, install an extension, nor turn the confinement off.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlEngine } from "../engine.ts";
import { createNodeSqlEngine } from "./engine.ts";

let workspace: string;
let outside: string;
let engine: SqlEngine;
beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "nimbo-query-sql-"));
  outside = join(workspace, "outside");
  await mkdir(outside);
  engine = createNodeSqlEngine({ directory: join(workspace, ".jsnb", "cache", "sql") });
  await engine.load();
});
afterAll(async () => {
  await engine.dispose();
  await rm(workspace, { recursive: true, force: true });
});

const refused = (sql: string) =>
  expect(engine.query(sql)).rejects.toMatchObject({ data: { reason: "query" } });

describe("confinement", () => {
  it("refuses to write a file outside its directory", async () => {
    const escaped = join(outside, "escaped.csv");
    await refused(`COPY (SELECT 42 AS x) TO '${escaped}' (FORMAT csv)`);
    expect(existsSync(escaped)).toBe(false);
  });

  it("refuses to read a file outside its directory", async () => {
    const secret = join(outside, "secret.txt");
    await writeFile(secret, "not for SQL");
    await refused(`SELECT content FROM read_text('${secret}')`);
    await refused(`SELECT * FROM read_json_auto('${secret}')`);
  });

  it("refuses to turn the confinement off or install an extension", async () => {
    await refused("SET enable_external_access = true");
    await refused(`SET allowed_directories = ['${outside}']`);
    await refused("INSTALL httpfs");
  });

  it("still registers and exports through its own directory", async () => {
    await engine.register("t", [{ a: 1 }, { a: 2 }]);
    const csv = await engine.exportAll("SELECT sum(a) AS s FROM t", { format: "csv" });
    expect(await csv.text()).toBe("s\n3\n");
  });
});
