// Worker crash recovery (11-query §5): work really in flight rejects `crashed`, the next call starts a new DuckDB and
// replays the registered tables and aliases; a reload aborted or disposed during its replay closes what it opened.
import { afterEach, describe, expect, it } from "vitest";

import type { Watch } from "./fixtures/workers.ts";
import { watchWorkers } from "./fixtures/workers.ts";
import { createSqlEngine } from "./page.ts";

/** Runs for minutes in DuckDB-WASM: a count over a trillion generated rows. */
const endless = "SELECT count(*) AS n FROM range(1000000000000)";

let watch: Watch | undefined;
afterEach(() => {
  watch?.restore();
});

/** Kills the worker the way a crash does: it stops, and its error event fires. */
const crash = (worker: Worker | undefined) => {
  worker?.terminate();
  worker?.dispatchEvent(new ErrorEvent("error", { message: "worker crashed", cancelable: true }));
};

/** True once the `index`-th worker the engine started was terminated. */
const wasTerminated = (index: number) => {
  const worker = watch?.started[index];
  return worker !== undefined && watch?.terminated.includes(worker) === true;
};

/** A Blob whose load keeps DuckDB busy for about a second. */
const bigBlob = () =>
  new Blob([
    JSON.stringify(Array.from({ length: 1_000_000 }, (_, a) => ({ a, text: `row ${String(a)}` }))),
  ]);

describe("worker crash", () => {
  it("rejects the query running in the worker with crashed, then reloads and replays", async () => {
    watch = watchWorkers();
    const engine = createSqlEngine();
    await engine.register("t", [{ a: 1 }, { a: 2 }], { alias: "events" });
    await engine.register("u", new Blob(['[{"b": "x"}]']));
    const running = engine.query(endless);
    await expect.poll(() => watch?.sent(endless)).toBe(true);
    crash(watch.started[0]);
    await expect(running).rejects.toMatchObject({
      name: "QueryError",
      data: { reason: "crashed" },
    });
    expect((await engine.query("SELECT sum(a) AS s FROM events")).rows).toEqual([{ s: 3 }]);
    expect((await engine.query("SELECT b FROM u")).rows).toEqual([{ b: "x" }]);
    expect((await engine.schema("t")).alias).toBe("events");
    expect(watch.started).toHaveLength(2);
    await engine.dispose();
  });

  it("treats a WebAssembly trap (RuntimeError) as a crash, and reloads on the next call", async () => {
    watch = watchWorkers({ trap: "/* trap */" });
    const engine = createSqlEngine();
    await engine.register("t", [{ a: 1 }]);
    await expect(engine.query("SELECT 1 /* trap */")).rejects.toMatchObject({
      data: { reason: "crashed" },
    });
    expect(watch.terminated).toEqual([watch.started[0]]);
    expect((await engine.query("SELECT a FROM t")).rows).toEqual([{ a: 1 }]);
    expect(watch.started).toHaveLength(2);
    await engine.dispose();
  });
});

describe("a reload that does not finish", () => {
  it("terminates the new worker when its only caller aborts during the replay", async () => {
    watch = watchWorkers();
    const engine = createSqlEngine();
    await engine.register("big", bigBlob());
    crash(watch.started[0]);
    const caller = new AbortController();
    const waiting = engine.query("SELECT 1", { signal: caller.signal });
    // The reload's worker received the replay's file handle: its replay is under way.
    await watch.whenPosted("REGISTER_FILE_HANDLE", 1);
    caller.abort();
    await expect(waiting).rejects.toMatchObject({ data: { reason: "cancelled" } });
    await expect.poll(() => wasTerminated(1)).toBe(true);
    expect((await engine.query("SELECT 2 AS n")).rows).toEqual([{ n: 2 }]);
    await engine.dispose();
  });

  it("terminates the new worker when the engine is disposed during the replay", async () => {
    watch = watchWorkers();
    const engine = createSqlEngine();
    await engine.register("big", bigBlob());
    crash(watch.started[0]);
    const waiting = engine.query("SELECT 1");
    // The reload's worker received the replay's file handle: its replay is under way.
    await watch.whenPosted("REGISTER_FILE_HANDLE", 1);
    await engine.dispose();
    await expect(waiting).rejects.toMatchObject({ data: { reason: "closed" } });
    await expect.poll(() => wasTerminated(1)).toBe(true);
  });
});

describe("after a crash", () => {
  it("forgets a table dropped after the crash, without loading DuckDB for it", async () => {
    watch = watchWorkers();
    const engine = createSqlEngine();
    await engine.register("t", [{ a: 1 }]);
    crash(watch.started[0]);
    await engine.drop("t");
    expect(watch.started).toHaveLength(1);
    await expect(engine.query("SELECT * FROM t")).rejects.toMatchObject({
      data: { reason: "query" },
    });
    await engine.dispose();
  });

  it("forgets a table its source can no longer rebuild, and replays the others", async () => {
    watch = watchWorkers();
    const engine = createSqlEngine();
    const rows: unknown[] = [{ a: 1 }];
    await engine.register("t", rows);
    await engine.register("u", [{ b: 2 }]);
    rows.push({ a: 2n });
    crash(watch.started[0]);
    expect((await engine.query("SELECT b FROM u")).rows).toEqual([{ b: 2 }]);
    await expect(engine.query("SELECT * FROM t")).rejects.toMatchObject({
      data: { reason: "query" },
    });
    await engine.dispose();
  });
});
