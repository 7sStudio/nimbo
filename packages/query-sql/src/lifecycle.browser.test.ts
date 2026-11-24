// The page engine's lifecycle: load with progress (the module's download paced by the test server), one worker for
// concurrent loads, load on first use, a failed or aborted load, dispose (work really in flight rejects `closed`, a
// later call loads afresh).
import { afterEach, describe, expect, it } from "vitest";

import type { LoadProgress } from "./engine.ts";
import type { Watch } from "./fixtures/workers.ts";
import { watchWorkers } from "./fixtures/workers.ts";
import { createSqlEngine } from "./page.ts";

const endless = "SELECT count(*) AS n FROM range(1000000000000)";

let watch: Watch | undefined;
afterEach(() => {
  watch?.restore();
});

const growing = (progress: readonly LoadProgress[]) =>
  progress.every(
    (value, index) => index === 0 || value.loadedBytes >= (progress[index - 1]?.loadedBytes ?? 0),
  );

/** Runs `task` with this page's .wasm downloads paced by the test server (tools/test/pacedDownloads.ts). */
async function paced(task: () => Promise<void>): Promise<void> {
  document.cookie = "jsnb-paced-download=1; path=/";
  try {
    await task();
  } finally {
    document.cookie = "jsnb-paced-download=; path=/; max-age=0";
  }
}

describe("load", () => {
  // DuckDB-WASM reports progress only for a chunk 20 ms or more after the one before: the module comes paced, in
  // slices 40 ms apart, so the real download reports whatever the cache or the machine's load
  it("reports the download with growing loadedBytes and a total", async () => {
    const engine = createSqlEngine();
    const progress: LoadProgress[] = [];
    await paced(() => engine.load((value) => progress.push(value)));
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.at(-1)?.totalBytes).toBeGreaterThan(1_000_000);
    expect(growing(progress)).toBe(true);
    await engine.dispose();
  });

  it("starts one worker for two concurrent loads, and none for a load after it", async () => {
    watch = watchWorkers();
    const engine = createSqlEngine();
    await Promise.all([engine.load(), engine.load()]);
    await engine.load();
    expect(watch.started).toHaveLength(1);
    await engine.dispose();
  });

  it("loads on first use when the host did not call load", async () => {
    const engine = createSqlEngine();
    expect((await engine.query("SELECT 41 + 1 AS n")).rows).toEqual([{ n: 42 }]);
    await engine.dispose();
  });

  it("refuses invalid options when the engine is created", () => {
    expect(() => createSqlEngine({ timeoutMs: -1 })).toThrow(/engine option timeoutMs = -1/u);
  });
});

describe("load failures", () => {
  it("rejects a worker that cannot start with load, then retries on the next call", async () => {
    watch = watchWorkers({ script: "throw new Error('worker script failed');" });
    const engine = createSqlEngine();
    const error = await engine.load().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: "QueryError", data: { reason: "load" } });
    watch.restore();
    await engine.load();
    expect((await engine.query("SELECT 1 AS ok")).rows).toEqual([{ ok: 1 }]);
    await engine.dispose();
  });

  it("aborts a load: rejects cancelled and terminates the half-started worker", async () => {
    watch = watchWorkers();
    const engine = createSqlEngine();
    const caller = new AbortController();
    const loading = engine.load(undefined, caller.signal);
    await expect.poll(() => watch?.started.length).toBe(1);
    caller.abort();
    await expect(loading).rejects.toMatchObject({ data: { reason: "cancelled" } });
    expect(watch.terminated).toEqual(watch.started);
    const signal = AbortSignal.abort();
    await expect(engine.load(undefined, signal)).rejects.toMatchObject({
      data: { reason: "cancelled" },
    });
    await engine.load();
    expect(watch.started).toHaveLength(2);
    await engine.dispose();
  });
});

describe("dispose", () => {
  it("rejects the query running in the worker with closed, and forgets the tables", async () => {
    watch = watchWorkers();
    const engine = createSqlEngine();
    await engine.register("t", [{ a: 1 }]);
    const running = engine.query(endless);
    await expect.poll(() => watch?.sent(endless)).toBe(true);
    const queued = engine.register("u", [{ a: 2 }]);
    await engine.dispose();
    await expect(running).rejects.toMatchObject({ data: { reason: "closed" } });
    await expect(queued).rejects.toMatchObject({ data: { reason: "closed" } });
    expect(watch.terminated).toEqual([watch.started[0]]);
    await expect(engine.query("SELECT * FROM t")).rejects.toMatchObject({
      data: { reason: "query" },
    });
    expect((await engine.query("SELECT 2 AS n")).rows).toEqual([{ n: 2 }]);
    await engine.dispose();
  });

  it("rejects a load in flight with closed", async () => {
    const engine = createSqlEngine();
    const loading = engine.load();
    await engine.dispose();
    await expect(loading).rejects.toMatchObject({ data: { reason: "closed" } });
    await engine.drop("never-registered");
  });
});
