// The query engines' lives through the daemon (11-query §3): a notebook that closes under a running SQL
// query ends it and closes DuckDB only after it, then queries again once reopened; a daemon that stops does the same;
// a value no longer kept in full, or a run that is not the last, is INVALID_PARAMS.
import { createNodeSqlEngine } from "@jsnb/query-sql/node";
import { withDaemon } from "../../fixtures/daemon.js";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { beforeAll, describe, expect, it } from "vitest";

import { createNotebook } from "../../fixtures/notebook.js";

const endless = "SELECT count(*) AS n FROM range(1000000000000)";

// Loads query-sql's DuckDB modules once for the file, as its own suites do, so no test pays the first import.
beforeAll(async () => {
  await withWorkspace(async (ws) => {
    const warm = createNodeSqlEngine({ directory: ws.path("warm") });
    await warm.load();
    await warm.dispose();
  });
});

describe("a notebook closed under a running SQL query", () => {
  it("ends the query with OutputQueryFailed, closes, and queries again once reopened", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.settings.set({ key: "query.timeoutMs", value: 60_000 });
      const book = await createNotebook(daemon);
      const { notebook } = book;
      const { cell } = await book.ran("[{ n: 1 }, { n: 2 }]");
      const ask = (query: string) =>
        daemon.client.cell.outputQuery({ notebook, cell, index: 0, mode: "sql", query });
      const running = ask(endless).then(
        () => undefined,
        (error: unknown) => error,
      );
      await daemon.client.notebook.close({ notebook });
      expect(await running).toMatchObject({ code: -32603, data: { name: "OutputQueryFailed" } });
      await daemon.client.notebook.open({ path: notebook });
      const again = await daemon.client.cell.add({
        notebook,
        type: "server",
        source: "[{ n: 5 }]",
        run: true,
      });
      const sum = await daemon.client.cell.outputQuery({
        ...{ notebook, cell: again.cell.id, index: 0 },
        ...{ mode: "sql", query: "SELECT sum(n) AS s FROM t" },
      });
      expect(sum.result.rows).toEqual([{ s: 5 }]);
    });
  });
});

describe("a daemon stopped under a running SQL query", () => {
  it("stops cleanly: the query's call ends and DuckDB closes after it", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.settings.set({ key: "query.timeoutMs", value: 60_000 });
      const book = await createNotebook(daemon);
      const { cell } = await book.ran("[{ n: 1 }]");
      const running = daemon.client.cell
        .outputQuery({ notebook: book.notebook, cell, index: 0, mode: "sql", query: endless })
        .then(
          () => "answered",
          () => "ended",
        );
      await daemon.stop();
      expect(await running).toBe("ended");
      await daemon.server.closed;
    });
  });
});

describe("cell.outputQuery of a value not kept in full", () => {
  it("is INVALID_PARAMS, as is a run that is not the cell's last", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.settings.set({ key: "outputs.retainFullValue", value: false });
      const book = await createNotebook(daemon);
      const { notebook } = book;
      const { cell, execution } = await book.ran(
        "Array.from({ length: 20000 }, (_, i) => ({ i, text: 'x'.repeat(20) }))",
      );
      await daemon.client.cell.run({ notebook, cell });
      const ask = (extra: object) =>
        daemon.client.cell.outputQuery({
          notebook,
          cell,
          index: 0,
          mode: "jsonpath",
          query: "$[0]",
          ...extra,
        });
      await expect(ask({})).rejects.toMatchObject({
        code: -32602,
        data: { issues: [{ path: ["index"] }] },
      });
      await expect(ask({ execution: execution.id })).rejects.toMatchObject({
        code: -32602,
        data: {
          issues: [
            { path: ["execution"], message: expect.stringContaining("last run") as unknown },
          ],
        },
      });
    });
  });
});
