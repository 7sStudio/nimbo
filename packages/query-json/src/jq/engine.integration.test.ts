// Worker-backed (integration tier): every test runs jq in a real worker thread.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CompiledTransform, RunOptions } from "../engine.ts";
import { chargeList } from "../fixtures/records.ts";
import { createJqEngine } from "./engine.ts";

const engine = createJqEngine();
beforeAll(() => engine.load());
afterAll(() => engine.dispose());

const compiled = (program: string, on = engine): CompiledTransform => {
  const result = on.compile(program);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const run = (program: string, json: unknown, options?: RunOptions) =>
  compiled(program).transform(json, options);

describe("createJqEngine transforms", () => {
  it("returns the only output as the value", async () => {
    expect(await run(".", { a: 1 })).toEqual({ ok: true, value: { value: { a: 1 }, count: 1 } });
  });

  it("returns several outputs as an array with their count", async () => {
    const result = await run(".data[] | select(.amount > 4000) | {id, amount}", chargeList(40));
    expect(result).toEqual({
      ok: true,
      value: {
        count: 6,
        value: [
          { id: "ch_000005", amount: 4595 },
          { id: "ch_000010", amount: 4190 },
          { id: "ch_000017", amount: 4623 },
          { id: "ch_000022", amount: 4218 },
          { id: "ch_000029", amount: 4651 },
          { id: "ch_000034", amount: 4246 },
        ],
      },
    });
  });
});

describe("createJqEngine values", () => {
  it("returns a single scalar output as it is", async () => {
    expect(await run(".data | length", chargeList(12))).toEqual({
      ok: true,
      value: { value: 12, count: 1 },
    });
  });

  it("returns no outputs as an empty array with count 0", async () => {
    expect(await run("empty", { a: 1 })).toEqual({ ok: true, value: { value: [], count: 0 } });
  });

  it("keeps strings, unicode and numbers intact", async () => {
    const value = {
      s: "é😀\u0000\n\"'\\",
      n: [0, -1.5, 1e300, 12345678901234, -0.000001],
      t: true,
      z: null,
    };
    expect(await run(".", value)).toEqual({ ok: true, value: { value, count: 1 } });
  });

  it("runs programs sent at once one after the other, and resolves them all", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => run(`. * ${String(n)}`, 10)));
    expect(results.map((r) => r.ok && r.value.value)).toEqual([10, 20, 30, 40, 50]);
  });
});

describe("createJqEngine syntax errors", () => {
  it("reports a syntax error with its offset on the first line", async () => {
    expect(await run("{a: }", {})).toEqual({
      ok: false,
      error: {
        kind: "syntax",
        message:
          "The jq program does not compile: syntax error, unexpected '}' at line 1, column 5. Fix the program at the marked position.",
        position: 4,
      },
    });
  });

  it("reports a syntax error on a later line at its offset in the whole program", async () => {
    const program = "1 +\n  .a |\n }";
    const result = await run(program, {});
    expect(result).toMatchObject({ ok: false, error: { kind: "syntax", position: 12 } });
    expect(program.charAt(12)).toBe("}");
  });

  it("counts jq's byte columns as characters after non-ASCII text", async () => {
    const program = `"é😀" | {a: }`;
    expect(await run(program, {})).toMatchObject({
      ok: false,
      error: { position: program.indexOf("}") },
    });
  });
});

describe("createJqEngine runtime errors", () => {
  it("reports a runtime error with jq's message", async () => {
    expect(await run(".a.b", { a: 1 })).toEqual({
      ok: false,
      error: {
        kind: "runtime",
        message:
          'The jq program failed on this value: Cannot index number with string ("b"). Check the program against the value\'s shape; ? and // skip the parts that may be missing.',
      },
    });
  });

  it("keeps halt_error's text as the message", async () => {
    expect(await run('"stop here" | halt_error', {})).toEqual({
      ok: false,
      error: { kind: "runtime", message: "stop here" },
    });
  });
});
