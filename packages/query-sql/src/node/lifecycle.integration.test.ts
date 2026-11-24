// The daemon's engine over time: load (no progress, nothing downloads), cancel and timeout through DuckDB's
// interrupt, dispose rejecting work in flight and freeing DuckDB only once its calls return, and a bad directory
// option.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DuckDBConnection } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { LoadProgress } from "../engine.ts";
import { createNodeSqlEngine } from "./engine.ts";

const endless = "SELECT count(*) AS n FROM range(1000000000000)";

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "nimbo-query-sql-"));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("load on Node", () => {
  it("opens DuckDB once and never reports progress, since nothing downloads", async () => {
    const engine = createNodeSqlEngine({ directory });
    const progress: LoadProgress[] = [];
    await Promise.all([engine.load((value) => progress.push(value)), engine.load()]);
    await engine.load();
    expect(progress).toEqual([]);
    expect((await engine.query("SELECT 42 AS n")).rows).toEqual([{ n: 42 }]);
    await engine.dispose();
  });

  it("refuses a missing directory and rejects an aborted load", async () => {
    expect(() => createNodeSqlEngine({ directory: "" })).toThrow(/directory/u);
    const engine = createNodeSqlEngine({ directory });
    await expect(engine.load(undefined, AbortSignal.abort())).rejects.toMatchObject({
      data: { reason: "cancelled" },
    });
    await engine.dispose();
  });
});

describe("cancel on Node", () => {
  it("interrupts a query through the signal and through query.timeoutMs, then keeps answering", async () => {
    const engine = createNodeSqlEngine({ directory, timeoutMs: 150 });
    const started = performance.now();
    await expect(engine.query(endless, { signal: AbortSignal.timeout(50) })).rejects.toMatchObject({
      data: { reason: "cancelled" },
    });
    await expect(engine.query(endless)).rejects.toMatchObject({ data: { reason: "timeout" } });
    await expect(engine.exportAll(endless, { format: "csv" })).rejects.toMatchObject({
      data: { reason: "timeout" },
    });
    expect(performance.now() - started).toBeLessThan(1500);
    expect((await engine.query("SELECT 1 AS ok")).rows).toEqual([{ ok: 1 }]);
    await engine.dispose();
  });

  it("rejects a statement DuckDB is running with closed on dispose, and loads afresh after", async () => {
    const streamed = vi.spyOn(DuckDBConnection.prototype, "stream");
    try {
      const engine = createNodeSqlEngine({ directory });
      await engine.register("t", [{ a: 1 }]);
      const running = engine.query(endless);
      await expect.poll(() => streamed.mock.calls.some(([sql]) => sql === endless)).toBe(true);
      await engine.dispose();
      await expect(running).rejects.toMatchObject({ data: { reason: "closed" } });
      await expect(engine.query("SELECT * FROM t")).rejects.toMatchObject({
        data: { reason: "query" },
      });
      expect((await engine.query("SELECT 1 AS ok")).rows).toEqual([{ ok: 1 }]);
      await engine.dispose();
    } finally {
      streamed.mockRestore();
    }
  });
});

describe("dispose under a running statement", () => {
  it("closes the statement's connection only once DuckDB has returned from its call", async () => {
    // node-api crashes the process (SIGSEGV) or hangs when a connection closes under a call DuckDB still runs
    const streams = vi.spyOn(DuckDBConnection.prototype, "stream");
    const closes = vi.spyOn(DuckDBConnection.prototype, "closeSync");
    try {
      const engine = createNodeSqlEngine({ directory });
      await engine.register("t", [{ a: 1 }]);
      const query = engine.query(endless);
      // DuckDB returns from the endless count's stream call only when interrupted
      const index = () => streams.mock.calls.findIndex(([sql]) => sql === endless);
      await expect.poll(index).not.toBe(-1);
      const result = streams.mock.results[index()];
      const call = result?.type === "return" ? (result.value as Promise<unknown>) : undefined;
      const closed = closes.mock.calls.length;
      let closedUnderCall: boolean | undefined;
      const record = () => {
        closedUnderCall = closes.mock.calls.length > closed;
      };
      const returned = call?.then(record, record);
      await engine.dispose();
      await expect(query).rejects.toMatchObject({ data: { reason: "closed" } });
      await returned;
      expect(closedUnderCall).toBe(false);
      await expect.poll(() => closes.mock.calls.length).toBe(closed + 1);
    } finally {
      streams.mockRestore();
      closes.mockRestore();
    }
  });
});
