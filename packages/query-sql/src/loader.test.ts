// The shared load: one start for concurrent callers, progress to each, an abort that lets only its caller go.
import { describe, expect, it } from "vitest";

import type { LoadProgress } from "./engine.ts";
import { QueryError } from "./errors.ts";
import { sharedLoad } from "./loader.ts";

/** A start the test settles by hand, recording each call's progress callback and signal. */
function manual() {
  const calls: {
    progress: (p: LoadProgress) => void;
    signal: AbortSignal;
    settle: (v: string) => void;
    fail: (e: unknown) => void;
  }[] = [];
  const start = (progress: (p: LoadProgress) => void, signal: AbortSignal) =>
    new Promise<string>((settle, fail) => {
      calls.push({ progress, signal, settle, fail });
    });
  return { calls, start };
}

describe("sharedLoad", () => {
  it("starts once for concurrent callers and gives each the value and the progress", async () => {
    const { calls, start } = manual();
    const load = sharedLoad(start, () => undefined);
    const seen: number[] = [];
    const first = load.acquire((p) => seen.push(p.loadedBytes));
    const second = load.acquire((p) => seen.push(p.loadedBytes * 10));
    expect(calls).toHaveLength(1);
    expect(load.running()).toBe(true);
    calls[0]?.progress({ loadedBytes: 1, totalBytes: 2 });
    calls[0]?.settle("db");
    expect(await Promise.all([first, second])).toEqual(["db", "db"]);
    expect(seen).toEqual([1, 10]);
    expect(load.running()).toBe(false);
  });

  it("lets an aborting caller go while the others keep waiting", async () => {
    const { calls, start } = manual();
    const load = sharedLoad(start, () => undefined);
    const caller = new AbortController();
    const leaving = load.acquire(undefined, caller.signal);
    const staying = load.acquire();
    caller.abort();
    await expect(leaving).rejects.toMatchObject({ data: { reason: "cancelled" } });
    expect(calls[0]?.signal.aborted).toBe(false);
    calls[0]?.settle("db");
    expect(await staying).toBe("db");
  });
});

describe("sharedLoad aborts", () => {
  it("aborts the start when the last caller leaves, and discards a value that comes after", async () => {
    const { calls, start } = manual();
    const discarded: string[] = [];
    const load = sharedLoad(start, (value) => discarded.push(value));
    const caller = new AbortController();
    const only = load.acquire(undefined, caller.signal);
    caller.abort();
    await expect(only).rejects.toMatchObject({ data: { reason: "cancelled" } });
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(load.running()).toBe(false);
    calls[0]?.settle("late");
    await Promise.resolve();
    expect(discarded).toEqual(["late"]);
    const next = load.acquire();
    expect(calls).toHaveLength(2);
    calls[1]?.settle("fresh");
    expect(await next).toBe("fresh");
  });
});

describe("sharedLoad failures", () => {
  it("rejects an already-aborted caller without starting", async () => {
    const { calls, start } = manual();
    const load = sharedLoad(start, () => undefined);
    await expect(load.acquire(undefined, AbortSignal.abort())).rejects.toMatchObject({
      data: { reason: "cancelled" },
    });
    expect(calls).toHaveLength(0);
  });

  it("rejects every caller with a load error and starts again on the next call", async () => {
    const { calls, start } = manual();
    const load = sharedLoad(start, () => undefined);
    const first = load.acquire();
    calls[0]?.fail(new TypeError("Failed to fetch"));
    await expect(first).rejects.toMatchObject({ data: { reason: "load" } });
    const second = load.acquire();
    calls[1]?.fail(new QueryError("crashed", "worker died"));
    await expect(second).rejects.toMatchObject({ data: { reason: "crashed" } });
  });

  it("stops: aborts the start and rejects the waiters with the given error", async () => {
    const { calls, start } = manual();
    const load = sharedLoad(start, () => undefined);
    const waiting = load.acquire();
    load.stop(new QueryError("closed", "closed"));
    await expect(waiting).rejects.toMatchObject({ data: { reason: "closed" } });
    expect(calls[0]?.signal.aborted).toBe(true);
    load.stop(new QueryError("closed", "closed"));
  });
});
