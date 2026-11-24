// Worker-backed (integration tier): the jq engine's lifecycle, timeout, abort, memory caps and isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CompiledTransform, TransformEngine } from "../engine.ts";
import { createJqEngine } from "./engine.ts";

const compiled = (engine: TransformEngine, program: string): CompiledTransform => {
  const result = engine.compile(program);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const engine = createJqEngine();
beforeAll(() => engine.load());
afterAll(() => engine.dispose());

describe("createJqEngine timeout and abort", () => {
  it("stops a program that runs past its timeout, then runs the next one in a fresh worker", async () => {
    const endless = await compiled(engine, "last(repeat(1))").transform(null, { timeoutMs: 50 });
    expect(endless).toMatchObject({ ok: false, error: { kind: "timeout" } });
    expect(endless.ok ? "" : endless.error.message).toBe(
      "The query ran longer than 50 ms and was stopped. Narrow it, or raise query.timeoutMs.",
    );
    expect(await compiled(engine, ". + 1").transform(1)).toEqual({
      ok: true,
      value: { value: 2, count: 1 },
    });
  });

  it("stops a running program when its signal aborts", async () => {
    const controller = new AbortController();
    const pending = compiled(engine, "last(repeat(1))").transform(null, {
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, error: { kind: "aborted" } });
    expect(await compiled(engine, "1").transform(null)).toMatchObject({ ok: true });
  });

  it("drops a queued program when its signal aborts, without touching the running one", async () => {
    const controller = new AbortController();
    const first = compiled(engine, "[range(0; 3)]").transform(null);
    const second = compiled(engine, "2").transform(null, { signal: controller.signal });
    controller.abort();
    expect(await second).toMatchObject({ ok: false, error: { kind: "aborted" } });
    expect(await first).toEqual({ ok: true, value: { value: [0, 1, 2], count: 1 } });
  });

  it("answers at once when the signal has already aborted", async () => {
    const result = await compiled(engine, "1").transform(null, { signal: AbortSignal.abort() });
    expect(result).toMatchObject({ ok: false, error: { kind: "aborted" } });
  });
});

describe("createJqEngine memory and values", () => {
  it("reports jq's WebAssembly heap running out as memory, then recovers", async () => {
    const result = await compiled(engine, '"x" * 300000000').transform(null);
    expect(result).toMatchObject({ ok: false, error: { kind: "memory" } });
    expect(await compiled(engine, "[1, 2]").transform(null)).toMatchObject({
      ok: true,
      value: { count: 1 },
    });
  });

  it("reports jq's stack overflowing on a deeply nested value as memory, then recovers in a fresh worker", async () => {
    const result = await compiled(engine, "reduce range(10000) as $i (0; [.])").transform(null);
    expect(result).toMatchObject({ ok: false, error: { kind: "memory" } });
    expect(await compiled(engine, ". + 1").transform(1)).toEqual({
      ok: true,
      value: { value: 2, count: 1 },
    });
  });

  it("refuses a value that cannot be sent to the worker", async () => {
    const result = await compiled(engine, ".").transform({ total: 10n });
    expect(result).toMatchObject({ ok: false, error: { kind: "runtime" } });
    expect(result.ok ? "" : result.error.message).toMatch(
      /^The value cannot be sent to the query worker as JSON \(/,
    );
  });
});

describe("createJqEngine with a small heap cap", () => {
  const small = createJqEngine({ memoryMb: 16 });
  beforeAll(() => small.load());
  afterAll(() => small.dispose());

  it("reports the worker's heap running out as memory, then recovers", async () => {
    // 40 000 strings of 1 000 characters: 40 MB of output, read into the worker's 16 MB heap.
    const result = await compiled(small, '[range(0; 40000) | "x" * 1000]').transform(null);
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "memory",
        message:
          "The query ran out of memory in the worker. Narrow the query or raise its memory cap.",
      },
    });
    expect(await compiled(small, "1").transform(null)).toMatchObject({ ok: true });
  });
});

describe("createJqEngine lifecycle", () => {
  it("is unavailable before load()", () => {
    expect(createJqEngine().compile(".")).toEqual({
      ok: false,
      error: {
        kind: "unavailable",
        message: "The jq engine is not loaded yet; call load() first and wait for it.",
      },
    });
  });

  it("shares one load between concurrent calls", async () => {
    const fresh = createJqEngine();
    const first = fresh.load();
    expect(fresh.load()).toBe(first);
    await first;
    await fresh.dispose();
  });

  it("ends a pending program on dispose, and loads again afterwards", async () => {
    const fresh = createJqEngine();
    await fresh.load();
    const pending = compiled(fresh, "last(repeat(1))").transform(null);
    await fresh.dispose();
    expect(await pending).toMatchObject({ ok: false, error: { kind: "aborted" } });
    expect(fresh.compile(".")).toMatchObject({ ok: false, error: { kind: "unavailable" } });
    await fresh.load();
    expect(await compiled(fresh, ".a").transform({ a: "back" })).toMatchObject({
      ok: true,
      value: { value: "back" },
    });
    await fresh.dispose();
  });
});

describe("createJqEngine timeouts from its options", () => {
  it("bounds programs by its timeoutMs, but not its own loading", async () => {
    const strict = createJqEngine({ timeoutMs: 1 });
    try {
      await strict.load();
      const result = await compiled(strict, "last(range(0; 100000000))").transform(null);
      expect(result).toMatchObject({ ok: false, error: { kind: "timeout" } });
    } finally {
      await strict.dispose();
    }
  });
});

describe("createJqEngine isolation", () => {
  it("never shows the host's environment to a program", async () => {
    process.env.NIMBO_QUERY_TEST_SECRET = "s3cr3t-value";
    const fresh = createJqEngine();
    try {
      await fresh.load();
      const result = await compiled(fresh, '[$ENV, env] | tostring | contains("s3cr3t")').transform(
        null,
      );
      expect(result).toEqual({ ok: true, value: { value: false, count: 1 } });
    } finally {
      delete process.env.NIMBO_QUERY_TEST_SECRET;
      await fresh.dispose();
    }
  });
});
