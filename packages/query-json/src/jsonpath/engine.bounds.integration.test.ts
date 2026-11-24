// Worker-backed (integration tier): the bounds that keep a select from holding the calling thread (11-query §2).
// Each test measures how long select() held the thread before it returned its promise.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CompiledSelect, SelectEngine } from "../engine.ts";
import { chargeList } from "../fixtures/records.ts";
import { createJsonPathEngine } from "./engine.ts";

const compiled = (engine: SelectEngine, query: string): CompiledSelect => {
  const result = engine.compile(query);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

/** The select's promise, and how long the call held the calling thread before returning it. */
const timed = (select: () => Promise<unknown>) => {
  const start = performance.now();
  const result = select();
  return { result, heldMs: performance.now() - start };
};

const inThread = createJsonPathEngine();
const shortSlice = createJsonPathEngine({ mainThreadSliceMs: 20 });
beforeAll(() => Promise.all([inThread.load(), shortSlice.load()]));
afterAll(() => Promise.all([inThread.dispose(), shortSlice.dispose()]));

/** One member whose name is `length` characters long, holding `items` numbers. */
const longKey = (length: number, items: number) => ({
  ["k".repeat(length)]: Array.from({ length: items }, (_, index) => index),
});

/** A linked list `depth` levels deep, as a cell might print one: 2 × depth + 1 nodes. */
const linkedList = (depth: number): unknown => {
  let list: unknown = null;
  for (let index = 0; index < depth; index += 1) list = { value: index, next: list };
  return list;
};

/** One-element arrays nested 30 deep: 31 nodes. */
const chain: unknown = Array.from({ length: 30 }).reduce<unknown>((inner) => [inner], 1);

describe("createJsonPathEngine bounds on the value and the query", () => {
  it("sends a value deeper than 64 levels to the worker, where a 20 000-deep list stops at its timeout", async () => {
    const start = performance.now();
    const result = await compiled(inThread, "$..value").select(linkedList(20_000), {
      timeoutMs: 200,
    });
    expect(result).toMatchObject({ ok: false, error: { kind: "timeout" } });
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("sends a bracket of several selectors to the worker, where a 2^22 fan-out stops at its timeout", async () => {
    const start = performance.now();
    const result = await compiled(inThread, `$${"[0,0]".repeat(22)}`).select(chain, {
      timeoutMs: 200,
    });
    expect(result).toMatchObject({ ok: false, error: { kind: "timeout" } });
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe("createJsonPathEngine time slice", () => {
  it("moves a select that outlasts its time slice to the worker", async () => {
    const sliced = createJsonPathEngine({ mainThreadSliceMs: 0 });
    await sliced.load();
    try {
      const value = { ...chargeList(300), total: 10n };
      expect(await compiled(sliced, "$..id").select(value)).toMatchObject({
        ok: false,
        error: {
          kind: "runtime",
          message: expect.stringMatching(
            /^The value cannot be sent to the query worker/,
          ) as unknown,
        },
      });
      const result = await compiled(sliced, "$..id").select(chargeList(300));
      expect(result.ok && result.value.paths.length).toBe(300);
    } finally {
      await sliced.dispose();
    }
  });
});

describe("createJsonPathEngine on long member names (11-query §2)", () => {
  it("holds the thread one slice at most on a 10 000-character name, then ends in the worker", async () => {
    const { result, heldMs } = timed(() =>
      compiled(shortSlice, "$.*[*]").select(longKey(10_000, 10_000), { timeoutMs: 200 }),
    );
    expect(heldMs).toBeLessThan(20 + 100);
    expect(await result).toMatchObject({ ok: false, error: { kind: "timeout" } });
  });

  it("sends a value with a longer name straight to the worker", async () => {
    const value = { ...longKey(20_000, 3), total: 10n };
    const { result, heldMs } = timed(() => compiled(inThread, "$.*[*]").select(value));
    expect(heldMs).toBeLessThan(50);
    expect(await result).toMatchObject({
      ok: false,
      error: {
        kind: "runtime",
        message: expect.stringMatching(/^The value cannot be sent to the query worker/) as unknown,
      },
    });
  });

  it("sends a value of more than 4 000 000 characters straight to the worker", async () => {
    const value = { lines: Array.from({ length: 50 }, () => "x".repeat(100_000)), total: 10n };
    const { result, heldMs } = timed(() => compiled(inThread, "$.lines[0]").select(value));
    expect(heldMs).toBeLessThan(50);
    expect(await result).toMatchObject({ ok: false, error: { kind: "runtime" } });
  });

  it("still selects a 10 000-character name in the calling thread when the slice allows", async () => {
    const result = await compiled(inThread, "$.*[*]").select({ ...longKey(10_000, 3), total: 10n });
    expect(result.ok && result.value.paths.length).toBe(3);
  });
});
