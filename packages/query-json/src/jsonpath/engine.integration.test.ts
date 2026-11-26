// Worker-backed (integration tier): JSONPath selects that run in a real worker thread, and their limits.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CompiledSelect, SelectEngine } from "../engine.ts";
import { chargeList, galleryQuery } from "../fixtures/records.ts";
import { createJsonPathEngine } from "./engine.ts";
import { measure } from "./size.ts";

const compiled = (engine: SelectEngine, query: string): CompiledSelect => {
  const result = engine.compile(query);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const inThread = createJsonPathEngine();
const viaWorker = createJsonPathEngine({ mainThreadNodeLimit: 50 });
beforeAll(() => Promise.all([inThread.load(), viaWorker.load()]));
afterAll(() => Promise.all([inThread.dispose(), viaWorker.dispose()]));

describe("createJsonPathEngine above the main-thread node limit", () => {
  it("selects in the worker the same paths as in the calling thread", async () => {
    const value = chargeList(200);
    const [worker, local] = await Promise.all([
      compiled(viaWorker, galleryQuery).select(value),
      compiled(inThread, galleryQuery).select(value),
    ]);
    const expected = value.data.flatMap((charge, index) =>
      charge.status === "succeeded" && charge.amount > 1000 ? [`$['data'][${String(index)}]`] : [],
    );
    expect(worker).toEqual({ ok: true, value: { paths: expected } });
    expect(local).toEqual(worker);
  });

  it("stops a select that runs past its timeout, then selects again", async () => {
    const value = chargeList(30_000);
    const slow = await compiled(viaWorker, "$..*").select(value, { timeoutMs: 5 });
    expect(slow).toMatchObject({ ok: false, error: { kind: "timeout" } });
    const next = await compiled(viaWorker, "$.has_more").select(chargeList(10));
    expect(next).toEqual({ ok: true, value: { paths: ["$['has_more']"] } });
  });

  it("stops a running select when its signal aborts", async () => {
    const controller = new AbortController();
    const pending = compiled(viaWorker, "$..id").select(chargeList(100), {
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, error: { kind: "aborted" } });
  });

  it("refuses a value that cannot be sent to the worker", async () => {
    const value = { ...chargeList(10), total: 10n };
    expect(await compiled(viaWorker, "$.url").select(value)).toMatchObject({
      ok: false,
      error: { kind: "runtime" },
    });
  });
});

/** 20 000 numbers: 20 001 nodes, well under the default node limit. */
const numbers = Array.from({ length: 20_000 }, (_, index) => index);

describe("createJsonPathEngine on a query whose cost is not linear", () => {
  it("stops an absolute query inside a filter at its timeout, on a value under the node limit", async () => {
    const start = performance.now();
    const result = await compiled(inThread, "$[?count($[*]) > 0]").select(numbers, {
      timeoutMs: 200,
    });
    expect(result).toMatchObject({ ok: false, error: { kind: "timeout" } });
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("stops a catastrophic regular expression at its timeout", async () => {
    const result = await compiled(inThread, `$[?match(@, "(a+)+b")]`).select(
      [`${"a".repeat(32)}c`],
      {
        timeoutMs: 200,
      },
    );
    expect(result).toMatchObject({ ok: false, error: { kind: "timeout" } });
  });

  it("stops it when its signal aborts mid-run", async () => {
    const controller = new AbortController();
    const pending = compiled(inThread, "$[?count($[*]) > 0]").select(numbers, {
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, error: { kind: "aborted" } });
  });

  it("sends it to the worker even for a tiny value", async () => {
    const value = ["a", 10n];
    expect(await compiled(inThread, `$[?search(@, "a")]`).select(value)).toMatchObject({
      ok: false,
      error: {
        kind: "runtime",
        message: expect.stringMatching(/^The value cannot be sent to the query worker/) as unknown,
      },
    });
  });
});

describe("createJsonPathEngine's default node limit of 100 000", () => {
  const withFiller = (filler: readonly number[]) => ({
    ...chargeList(9090),
    filler,
    total: 10n, // a BigInt: no worker can be sent it
  });

  it("selects a value of exactly 100 000 nodes in the calling thread", async () => {
    const value = withFiller([0, 1, 2]);
    expect(
      measure(value, { nodes: Infinity, depth: Infinity, chars: Infinity, longestName: Infinity })
        .nodes,
    ).toBe(100_000);
    expect(await compiled(inThread, "$.url").select(value)).toEqual({
      ok: true,
      value: { paths: ["$['url']"] },
    });
  });

  it("sends a value of 100 001 nodes to the worker", async () => {
    const value = withFiller([0, 1, 2, 3]);
    expect(
      measure(value, { nodes: Infinity, depth: Infinity, chars: Infinity, longestName: Infinity })
        .nodes,
    ).toBe(100_001);
    expect(await compiled(inThread, "$.url").select(value)).toMatchObject({
      ok: false,
      error: {
        kind: "runtime",
        message: expect.stringMatching(/^The value cannot be sent to the query worker/) as unknown,
      },
    });
  });
});
