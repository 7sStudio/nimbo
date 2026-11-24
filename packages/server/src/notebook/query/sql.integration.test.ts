// The SQL tables of one notebook on the real DuckDB (11-query §3): a value loaded into `t` once for any
// number of queries on it and again only for another value, a timeout as a result, a forgotten value let go, and a
// dispose that waits for the calls in flight, which end, before DuckDB closes.
import { createNodeSqlEngine } from "@jsnb/query-sql/node";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { beforeAll, describe, expect, it } from "vitest";

import { createSqlTables } from "./sql.js";

const endless = "SELECT count(*) AS n FROM range(1000000000000)";

// Loads query-sql's DuckDB modules once for the file, as its own suites do, so no test pays the first import.
beforeAll(async () => {
  await withWorkspace(async (ws) => {
    const warm = createNodeSqlEngine({ directory: ws.path("warm") });
    await warm.load();
    await warm.dispose();
  });
});

/** Rows that count their loads. */
const counted = (rows: readonly unknown[]) => {
  const loads = { n: 0 };
  return {
    loads,
    rows: () => {
      loads.n += 1;
      return rows;
    },
  };
};

describe("createSqlTables", () => {
  it("loads a value into t once for its queries, and again only for another value", async () => {
    await withWorkspace(async (ws) => {
      const tables = createSqlTables(ws.path(".jsnb/cache/sql"));
      try {
        const a = counted([{ x: 1 }, { x: 2 }]);
        const b = counted([{ x: 10 }]);
        const ask = (
          key: string,
          rows: () => readonly unknown[],
          sql = "SELECT sum(x) AS s FROM t",
        ) => tables.query({ key, rows, sql, limit: 10, timeoutMs: 5000 });
        expect(await ask("e1:0", a.rows)).toMatchObject({ ok: true, value: { rows: [{ s: 3 }] } });
        expect(await ask("e1:0", a.rows, "SELECT count(*) AS n FROM t")).toMatchObject({
          value: { rows: [{ n: 2 }] },
        });
        expect(await ask("e2:0", b.rows)).toMatchObject({ value: { rows: [{ s: 10 }] } });
        tables.forget("e2:0");
        expect(await ask("e2:0", b.rows)).toMatchObject({ value: { rows: [{ s: 10 }] } });
        expect([a.loads.n, b.loads.n]).toEqual([1, 2]);
      } finally {
        await tables.dispose();
      }
    });
  });
});

describe("createSqlTables' timeout and dispose", () => {
  it("answers timedOut past the timeout, and disposes only once the call in flight has ended", async () => {
    await withWorkspace(async (ws) => {
      const tables = createSqlTables(ws.path(".jsnb/cache/sql"));
      const rows = () => [{ x: 1 }];
      const late = await tables.query({
        key: "e1:0",
        rows,
        sql: endless,
        limit: 10,
        timeoutMs: 50,
      });
      expect(late).toEqual({ ok: false, timedOut: true });
      // A new value, so the call loads it: once its rows are read, the call is in DuckDB.
      const loading = Promise.withResolvers<undefined>();
      const fresh = () => {
        loading.resolve(undefined);
        return [{ x: 2 }];
      };
      const request = { key: "e2:0", rows: fresh, sql: endless, limit: 10, timeoutMs: 60_000 };
      const settled = tables.query(request).then(
        () => "answered",
        (error: unknown) => (error instanceof Error ? error.name : "?"),
      );
      await loading.promise;
      await tables.dispose();
      expect(await settled).toBe("QueryError");
    });
  });
});
