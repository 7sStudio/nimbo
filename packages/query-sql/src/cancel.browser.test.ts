// Cancel and timeout in the page engine (11-query §3, 03-api §4.10): DuckDB's interrupt stops the query fast, the
// call says which stop fired, and the engine keeps answering afterwards.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlEngine } from "./engine.ts";
import { createSqlEngine } from "./page.ts";

/** Runs for minutes in DuckDB-WASM: a count over a trillion generated rows. */
const endless = "SELECT count(*) AS n FROM range(1000000000000)";

let engine: SqlEngine;
beforeAll(async () => {
  engine = createSqlEngine();
  await engine.load();
});
afterAll(() => engine.dispose());

/** Registers the two rows the tests check the engine against, as `t`. */
const small = (target: SqlEngine) => target.register("t", [{ a: 1 }, { a: 2 }]);

const stillAnswers = async (target: SqlEngine) => {
  expect((await target.query("SELECT sum(a) AS s FROM t")).rows).toEqual([{ s: 3 }]);
};

describe("cancel", () => {
  it("stops a running query through the caller's signal, fast", async () => {
    await small(engine);
    const started = performance.now();
    const error = await engine
      .query(endless, { signal: AbortSignal.timeout(100) })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: "QueryError", data: { reason: "cancelled" } });
    expect(performance.now() - started).toBeLessThan(2000);
    await stillAnswers(engine);
  });

  it("rejects an already-aborted signal before sending anything", async () => {
    await small(engine);
    const signal = AbortSignal.abort();
    await expect(engine.query("SELECT 1", { signal })).rejects.toMatchObject({
      data: { reason: "cancelled" },
    });
    await expect(engine.register("aborted_u", [{ a: 1 }], { signal })).rejects.toMatchObject({
      data: { reason: "cancelled" },
    });
    await expect(engine.exportAll("SELECT 1", { format: "csv", signal })).rejects.toMatchObject({
      data: { reason: "cancelled" },
    });
    await expect(engine.schema("aborted_u")).rejects.toMatchObject({ data: { reason: "query" } });
  });
});

describe("cancel exports and registrations", () => {
  it("stops an export through the caller's signal", async () => {
    await small(engine);
    const signal = AbortSignal.timeout(100);
    await expect(engine.exportAll(endless, { format: "ndjson", signal })).rejects.toMatchObject({
      data: { reason: "cancelled" },
    });
    await stillAnswers(engine);
  });

  it("interrupts a registration's CREATE TABLE and keeps the previous table", async () => {
    await small(engine);
    const rows = Array.from({ length: 1_000_000 }, (_, index) => ({
      a: index,
      text: `row ${String(index)}`,
    }));
    const blob = new Blob([JSON.stringify(rows)]);
    const signal = AbortSignal.timeout(100);
    await expect(engine.register("t", blob, { signal })).rejects.toMatchObject({
      data: { reason: "cancelled" },
    });
    await stillAnswers(engine);
  });

  it("cancels a registration queued behind another before it starts", async () => {
    await small(engine);
    const caller = new AbortController();
    const first = engine.register("u", [{ a: 1 }]);
    const second = engine.register("t", [{ a: 9 }], { signal: caller.signal });
    caller.abort();
    await first;
    await expect(second).rejects.toMatchObject({ data: { reason: "cancelled" } });
    await stillAnswers(engine);
  });
});

describe("timeout", () => {
  it("stops a query at query.timeoutMs and says so", async () => {
    const strict = createSqlEngine({ timeoutMs: 150 });
    await small(strict);
    const started = performance.now();
    const error = await strict.query(endless).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: "QueryError", data: { reason: "timeout" } });
    expect(String(error)).toContain("150 ms");
    expect(performance.now() - started).toBeLessThan(2000);
    await stillAnswers(strict);
    await expect(strict.exportAll(endless, { format: "csv" })).rejects.toMatchObject({
      data: { reason: "timeout" },
    });
    await stillAnswers(strict);
    await strict.dispose();
  });
});
