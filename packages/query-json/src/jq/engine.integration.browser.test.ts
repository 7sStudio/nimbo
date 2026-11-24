// Browser (Chromium) and worker-backed: jq in a module Web Worker, as the page runs it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { HeldTransform } from "../engine.ts";
import { createJqEngine } from "./engine.ts";

const engine = createJqEngine();
beforeAll(() => engine.load());
afterAll(() => engine.dispose());

const compiled = (program: string): HeldTransform => {
  const result = engine.compile(program);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

describe("createJqEngine in a Web Worker", () => {
  it("runs in a page, where Worker is the Web Worker", () => {
    expect(typeof Worker).toBe("function");
    expect(typeof document).toBe("object");
  });

  it("transforms a value", async () => {
    expect(await compiled("[.[] | . * 2]").transform([1, 2, 3])).toEqual({
      ok: true,
      value: { value: [2, 4, 6], count: 1 },
    });
  });

  it("reports a syntax error with its position", async () => {
    expect(await compiled(".a | {b: }").transform({})).toMatchObject({
      ok: false,
      error: { kind: "syntax", position: 9 },
    });
  });

  it("transforms a held value, which the worker keeps between programs", async () => {
    engine.hold("list", { data: [1, 2, 3] });
    expect(await compiled(".data | add").transformHeld("list")).toEqual({
      ok: true,
      value: { value: 6, count: 1 },
    });
    expect(await compiled(".data | length").transformHeld("list")).toEqual({
      ok: true,
      value: { value: 3, count: 1 },
    });
    engine.release("list");
  });

  it("stops a program past its timeout, then transforms in a fresh worker", async () => {
    expect(await compiled("last(repeat(1))").transform(null, { timeoutMs: 50 })).toMatchObject({
      ok: false,
      error: { kind: "timeout" },
    });
    expect(await compiled(".a").transform({ a: "again" })).toMatchObject({
      ok: true,
      value: { value: "again" },
    });
  });
});
