// Tests of held.ts at unit tier: what a held query sends to the worker of each generation, the bound and its oldest-
// first eviction, and releases, over plain values (no worker: the engines' integration tests run the real ones).
import { describe, expect, it } from "vitest";

import { boundOf, createHeldValues, defaultHeldMaxBytes, utf8Length } from "./held.ts";

describe("utf8Length", () => {
  it("counts the UTF-8 bytes of a JSON text, as Buffer.byteLength does", () => {
    for (const text of ["", "abc", "é", "€", "😀", '"é😀\\u0000€x"', "日本語".repeat(9)]) {
      expect(utf8Length(text)).toBe(Buffer.byteLength(text));
    }
  });
});

describe("boundOf", () => {
  it("reads a number, a function, or 64 MiB by default", () => {
    expect([boundOf(10)(), boundOf(() => 20)(), boundOf(undefined)()]).toEqual([
      10,
      20,
      defaultHeldMaxBytes,
    ]);
  });
});

describe("createHeldValues payloads", () => {
  it("sends a value once per worker generation, and again to the next worker", () => {
    const held = createHeldValues(() => 1000);
    const value = { a: [1, 2] };
    held.hold("k", value);
    expect(held.payload("k", value, 1)).toEqual({
      ok: true,
      value: { kind: "held", json: '{"a":[1,2]}', drop: [] },
    });
    expect(held.payload("k", value, 1)).toEqual({ ok: true, value: { kind: "held", drop: [] } });
    expect(held.payload("k", value, 2)).toMatchObject({ ok: true, value: { json: '{"a":[1,2]}' } });
  });

  it("keeps a value held when the same value is held again, and sends a different one", () => {
    const held = createHeldValues(() => 1000);
    const value = [1];
    held.hold("k", value);
    held.payload("k", value, 1);
    held.hold("k", value);
    expect(held.payload("k", value, 1)).toEqual({ ok: true, value: { kind: "held", drop: [] } });
    const other = [2];
    held.hold("k", other);
    expect(held.payload("k", other, 1)).toEqual({
      ok: true,
      value: { kind: "held", json: "[2]", drop: [] },
    });
  });
});

describe("createHeldValues payloads of values not held", () => {
  it("runs a query on the value it was asked for once its key was released or held again", () => {
    const held = createHeldValues(() => 1000);
    const asked = { n: 1 };
    held.hold("k", asked);
    held.hold("k", { n: 2 });
    expect(held.payload("k", asked, 1)).toEqual({
      ok: true,
      value: { kind: "own", json: '{"n":1}' },
    });
    held.release("k", 1);
    expect(held.payload("k", asked, 1)).toEqual({
      ok: true,
      value: { kind: "own", json: '{"n":1}' },
    });
  });

  it("never holds a value larger than the bound: each of its queries carries it", () => {
    const held = createHeldValues(() => 4);
    const value = "too long";
    held.hold("k", value);
    for (let query = 0; query < 2; query += 1) {
      expect(held.payload("k", value, 1)).toEqual({
        ok: true,
        value: { kind: "own", json: '"too long"' },
      });
    }
  });

  it("answers a value JSON cannot write as the query's failure", () => {
    const held = createHeldValues(() => 1000);
    const value = { n: 1n };
    held.hold("k", value);
    expect(held.payload("k", value, 1)).toMatchObject({ ok: false, error: { kind: "runtime" } });
    expect(held.payload("other", value, 1)).toMatchObject({
      ok: false,
      error: { kind: "runtime" },
    });
  });
});

describe("createHeldValues bound", () => {
  it("forgets the oldest values the worker holds to keep within the bound, naming them in the payload", () => {
    const held = createHeldValues(() => 10);
    const values = { a: "aaa", b: "bbb", c: "ccccc" }; // 5, 5 and 7 bytes of JSON text
    for (const [key, value] of Object.entries(values)) held.hold(key, value);
    held.payload("a", values.a, 1);
    held.payload("b", values.b, 1);
    expect(held.payload("c", values.c, 1)).toEqual({
      ok: true,
      value: { kind: "held", json: '"ccccc"', drop: ["a", "b"] },
    });
    expect(held.value("a")).toMatchObject({ ok: false, error: { kind: "unavailable" } });
    expect(held.value("c")).toEqual({ ok: true, value: "ccccc" });
  });

  it("counts only what the current worker holds, and the newest hold last", () => {
    let bound = 10;
    const held = createHeldValues(() => bound);
    held.hold("a", "aaa");
    held.payload("a", "aaa", 1);
    held.hold("b", "bbb");
    held.payload("b", "bbb", 2);
    held.hold("a", "aaa"); // held again: now the newest
    held.hold("c", "c");
    held.payload("a", "aaa", 2);
    bound = 9;
    expect(held.payload("c", "c", 2)).toEqual({
      ok: true,
      value: { kind: "held", json: '"c"', drop: ["b"] },
    });
  });
});

describe("createHeldValues release and clear", () => {
  it("says whether the given worker holds a released key", () => {
    const held = createHeldValues(() => 1000);
    held.hold("a", 1);
    held.hold("b", 2);
    held.payload("a", 1, 1);
    expect([held.release("a", 1), held.release("b", 1), held.release("x", 1)]).toEqual([
      true,
      false,
      false,
    ]);
    expect(held.value("a")).toEqual({
      ok: false,
      error: {
        kind: "unavailable",
        message: "Nothing is held under a. Hold the value (hold), then run the query.",
      },
    });
  });

  it("forgets everything on clear", () => {
    const held = createHeldValues(() => 1000);
    held.hold("a", 1);
    held.clear();
    expect(held.value("a")).toMatchObject({ ok: false });
  });
});
