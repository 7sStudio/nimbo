// Tests of jq/serve.ts in the test's own thread: the jq worker's side with a real jq instance, without a worker.
import { beforeAll, describe, expect, it } from "vitest";

import { createJqServer } from "./serve.ts";

const serve = createJqServer();
// jq loaded and a first program run: jq-wasm compiles its code on the first run in a process (about 10 ms, once), a
// cost of the process and not of the program a test runs. (Paying it at load in the server instead was measured: a
// first run over `null` left every later run over a 28 MB value 13 % slower, so the server keeps it lazy.)
beforeAll(async () => {
  await serve({ kind: "warm-jq" });
  await serve({ kind: "jq", program: ".", json: "null" });
});

describe("createJqServer", () => {
  it("answers warm-jq once jq is loaded", async () => {
    expect(await serve({ kind: "warm-jq" })).toEqual({ ok: true, value: null });
  });

  it("runs a jq program over the value its JSON text holds", async () => {
    expect(await serve({ kind: "jq", program: ".a + 1", json: '{"a":1}' })).toEqual({
      ok: true,
      value: { value: 2, count: 1 },
    });
  });
});

describe("createJqServer held values", () => {
  it("keeps the JSON text a held task carries and runs on it by key after that", async () => {
    const json = '{"data":[1,2,3]}';
    expect(await serve({ kind: "jq-held", program: ".data | add", key: "k", json })).toEqual({
      ok: true,
      value: { value: 6, count: 1 },
    });
    expect(await serve({ kind: "jq-held", program: ".data | length", key: "k" })).toEqual({
      ok: true,
      value: { value: 3, count: 1 },
    });
  });

  it("forgets dropped and released keys", async () => {
    await serve({ kind: "jq-held", program: ".", key: "a", json: "1" });
    await serve({ kind: "jq-held", program: ".", key: "b", json: "2", drop: ["a"] });
    expect(await serve({ kind: "release", keys: ["b"] })).toEqual({ ok: true, value: null });
    for (const key of ["a", "b"]) {
      expect(await serve({ kind: "jq-held", program: ".", key })).toEqual({
        ok: false,
        error: {
          kind: "unavailable",
          message: `The query worker does not hold ${key}. Hold the value again, then run the query.`,
        },
      });
    }
  });
});

describe("createJqServer on unusual input", () => {
  it.each([
    [{ kind: "jsonpath", query: "$", json: "[]" }],
    [{ kind: "jsonpath-held", query: "$", key: "k" }],
    [{ kind: "jq-held", program: ".", key: 1 }],
    [{ kind: "release", keys: [1] }],
    [{ kind: "jq", program: ".", input: null }],
    [{ kind: "eval", code: "1" }],
  ])("refuses %j, which is not a jq task", async (task) => {
    expect(await serve(task)).toMatchObject({ ok: false, error: { kind: "unavailable" } });
  });

  it("reports a compile error without a location", async () => {
    expect(await serve({ kind: "jq", program: 'import "missing" as m; .', json: "null" })).toEqual({
      ok: false,
      error: {
        kind: "syntax",
        message:
          "The jq program does not compile: module not found: missing. Fix the program and run it again.",
      },
    });
  });
});

describe("createJqServer after a WebAssembly trap", () => {
  const fresh = createJqServer();
  beforeAll(() => fresh({ kind: "warm-jq" }));

  it("reports an exhausted heap as memory, then loads a new jq instance", async () => {
    expect(await fresh({ kind: "jq", program: '"x" * 300000000', json: "null" })).toMatchObject({
      ok: false,
      error: {
        kind: "memory",
        message: expect.stringMatching(/capped at 256 MB.*JSONPath or SQL/) as unknown,
      },
    });
    expect(await fresh({ kind: "jq", program: "[1]", json: "null" })).toEqual({
      ok: true,
      value: { value: [1], count: 1 },
    });
  });

  it("reports jq's stack overflowing on a deeply nested value as memory, then loads a new jq instance", async () => {
    expect(
      await fresh({ kind: "jq", program: "reduce range(10000) as $i (0; [.])", json: "null" }),
    ).toEqual({
      ok: false,
      error: {
        kind: "memory",
        message:
          "jq failed inside its WebAssembly runtime (memory access out of bounds), most often on a value nested too deeply for it. Narrow the input or the program and run it again.",
      },
    });
    expect(await fresh({ kind: "jq", program: ". + 1", json: "1" })).toEqual({
      ok: true,
      value: { value: 2, count: 1 },
    });
  });
});
