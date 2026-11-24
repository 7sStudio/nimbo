// cell.outputQuery through the daemon (03-api §4.3, 11-query): Filter chips and JSONPath select paths and the nodes
// they name, jq transforms, SQL runs on the value's plain rows as `t`; a wrong query is INVALID_PARAMS on `query`, a
// timeout a result; only a full value is queried.
import { createNodeSqlEngine } from "@jsnb/query-sql/node";
import type { Daemon } from "../../fixtures/daemon.js";
import { withDaemon } from "../../fixtures/daemon.js";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { beforeAll, describe, expect, it } from "vitest";

import { createNotebook } from "../../fixtures/notebook.js";

const source = `[
  { id: 1, status: "failed", created: new Date("2026-10-10T14:02:11.000Z"), score: NaN },
  { id: 2, status: "ok", created: new Date("2026-10-11T08:30:00.125Z"), score: 2 },
  { id: 3, status: "failed", created: new Date("2026-10-12T00:00:00.000Z"), score: 3 },
]`;

// Loads query-sql's DuckDB modules once for the file, as its own suites do, so no test pays the first import.
beforeAll(async () => {
  await withWorkspace(async (ws) => {
    const warm = createNodeSqlEngine({ directory: ws.path("warm") });
    await warm.load();
    await warm.dispose();
  });
});

/** A notebook whose cell ran `source`, and cell.outputQuery on its value. */
async function rowsValue(daemon: Daemon) {
  const book = await createNotebook(daemon);
  const { cell } = await book.ran(source);
  type Mode = "filter" | "jsonpath" | "jq" | "sql";
  const query = (mode: Mode, text: unknown, extra: object = {}) =>
    daemon.client.cell.outputQuery({
      notebook: book.notebook,
      cell,
      index: 0,
      mode,
      query: text as string,
      ...extra,
    });
  return { book, cell, query };
}

describe("cell.outputQuery in jsonpath and filter modes", () => {
  it("answers the matching paths, the nodes they name and the count", async () => {
    await withDaemon(async (daemon) => {
      const { query } = await rowsValue(daemon);
      const ids = await query("jsonpath", '$[?@.status == "failed"].id');
      expect(ids).toMatchObject({ mode: "jsonpath", total: 2, truncated: false });
      expect(ids.result).toEqual({ paths: ["$[0]['id']", "$[2]['id']"], value: [1, 3] });
      expect(ids.durationMs).toBeGreaterThanOrEqual(0);
      const one = await query("jsonpath", "$[*].id", { limit: 1 });
      expect(one).toMatchObject({
        result: { paths: ["$[0]['id']"], value: [1] },
        total: 3,
        truncated: true,
      });
      const chips = await query("filter", [{ key: "status", op: "startsWith", value: "fai" }]);
      expect(chips.result.paths).toEqual(["$[0]", "$[2]"]);
      expect(chips.result.value).toMatchObject([{ id: 1 }, { id: 3 }]);
    });
  });
});

describe("cell.outputQuery's refusals", () => {
  it("answers INVALID_PARAMS on `query` for a wrong query or the wrong kind of query", async () => {
    await withDaemon(async (daemon) => {
      const { query } = await rowsValue(daemon);
      const wrong: readonly (readonly [Parameters<typeof query>[0], unknown])[] = [
        ["jsonpath", "$["],
        ["jsonpath", [{ key: "id", op: "exists" }]],
        ["filter", "$[*]"],
        ["filter", [{ key: "id", op: "=" }]],
        ["filter", [{ key: "id", op: "contains", value: 1 }]],
        ["jq", "map("],
        ["jq", ".[0].status | .x"],
        ["sql", "SELEC 1"],
      ];
      for (const [mode, text] of wrong) {
        await expect(query(mode, text)).rejects.toMatchObject({
          code: -32602,
          data: { issues: [{ path: expect.arrayContaining(["query"]) as unknown }] },
        });
      }
    });
  });
});

describe("cell.outputQuery in jq mode", () => {
  it("answers the program's value, its outputs as an array when there are several, capped at limit", async () => {
    await withDaemon(async (daemon) => {
      const { query } = await rowsValue(daemon);
      expect(await query("jq", "map(.id)")).toMatchObject({
        result: { value: [1, 2, 3] },
        total: 1,
        truncated: false,
      });
      expect(await query("jq", ".[] | .id")).toMatchObject({
        result: { value: [1, 2, 3] },
        total: 3,
      });
      expect(await query("jq", ".[] | .id", { limit: 2 })).toMatchObject({
        result: { value: [1, 2] },
        total: 3,
        truncated: true,
      });
    });
  });
});

describe("cell.outputQuery in sql mode", () => {
  it("runs on the plain rows as t: dates as ISO text, NaN as null, capped at query.sqlMaxRows", async () => {
    await withDaemon(async (daemon) => {
      const { query } = await rowsValue(daemon);
      const grouped = await query(
        "sql",
        "SELECT status, count(*) AS n FROM t GROUP BY 1 ORDER BY 1",
      );
      expect(grouped.result.columns?.map((column) => column.name)).toEqual(["status", "n"]);
      expect(grouped).toMatchObject({
        result: {
          rows: [
            { status: "failed", n: 2 },
            { status: "ok", n: 1 },
          ],
        },
        total: 2,
      });
      const first = await query("sql", "SELECT created, score FROM t WHERE id = 1");
      expect(first.result.rows).toEqual([{ created: "2026-10-10T14:02:11.000Z", score: null }]);
      // another table is named as such, not with DuckDB's guess at one of its catalog tables
      await expect(query("sql", "SELECT * FROM orders")).rejects.toMatchObject({
        name: "InvalidParams",
        message: expect.stringContaining("the value is table t") as unknown,
      });
      await daemon.client.settings.set({ key: "query.sqlMaxRows", value: 1 });
      const capped = await query("sql", "SELECT id FROM t ORDER BY id");
      expect(capped).toMatchObject({ result: { rows: [{ id: 1 }] }, total: 3, truncated: true });
    });
  });
});

describe("cell.outputQuery and cell.outputValue without index", () => {
  it("read the last value output of the cell's last run, and say why when there is none", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { cell } = await book.ran('console.log("first"); [{ a: 1 }, { a: 2 }]');
      const at = { notebook: book.notebook, cell };
      const sum = await daemon.client.cell.outputQuery({
        ...at,
        mode: "jq",
        query: "map(.a) | add",
      });
      expect(sum.result.value).toBe(3);
      expect((await daemon.client.cell.outputValue({ ...at, path: "$[1]" })).json).toEqual({
        a: 2,
      });
      const quiet = await book.ran('console.log("no value"); undefined;');
      await expect(
        daemon.client.cell.outputQuery({ ...at, cell: quiet.cell, mode: "jq", query: "." }),
      ).rejects.toMatchObject({ name: "InvalidParams", data: { issues: [{ path: ["index"] }] } });
    });
  });
});

describe("a query past query.timeoutMs", () => {
  it("is a result with timedOut and nothing in it, in jq and in sql", async () => {
    await withDaemon(async (daemon) => {
      const { query } = await rowsValue(daemon);
      await daemon.client.settings.set({ key: "query.timeoutMs", value: 100 });
      const late = { result: {}, total: 0, truncated: true, timedOut: true };
      expect(await query("jq", "last(repeat(1))")).toMatchObject({ mode: "jq", ...late });
      expect(await query("sql", "SELECT count(*) AS n FROM range(1000000000000)")).toMatchObject(
        late,
      );
    });
  });
});
