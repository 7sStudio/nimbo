// Tests decode: every marker comes back as its runtime value, refs restore identity, cycles close.
import { describe, expect, it } from "vitest";

import { decode } from "./decode.js";
import { encode } from "./encode.js";

describe("decode", () => {
  it("rebuilds the special values", () => {
    expect(decode({ $type: "undefined" })).toBeUndefined();
    expect(decode({ $type: "number", value: "NaN" })).toBeNaN();
    expect(Object.is(decode({ $type: "number", value: "-0" }), -0)).toBe(true);
    expect(decode({ $type: "number", value: "Infinity" })).toBe(Number.POSITIVE_INFINITY);
    expect(decode({ $type: "number", value: "-Infinity" })).toBe(Number.NEGATIVE_INFINITY);
    expect(decode({ $type: "number", value: "7" })).toBe(7);
    expect(decode({ $type: "bigint", value: "9" })).toBe(9n);
    expect(decode({ $type: "date", iso: "2026-10-10T14:02:11.000Z" })).toEqual(
      new Date("2026-10-10T14:02:11.000Z"),
    );
    const invalid = decode({ $type: "date", iso: null });
    expect(invalid instanceof Date && Number.isNaN(invalid.getTime())).toBe(true);
    expect(decode({ $type: "regexp", source: "a+", flags: "g" })).toEqual(/a+/g);
    expect(decode({ $type: "regexp" })).toEqual(new RegExp(""));
    expect(decode({ $type: "bytes", length: 2, base64: "aGk=" })).toEqual(
      new Uint8Array([104, 105]),
    );
  });

  it("rebuilds maps and sets and tolerates malformed entries", () => {
    expect(decode({ $type: "map", entries: [["k", 1], "junk"] })).toEqual(new Map([["k", 1]]));
    expect(decode({ $type: "set", values: [1, 1] })).toEqual(new Set([1]));
    expect(decode({ $type: "map" })).toEqual(new Map());
    expect(decode({ $type: "set" })).toEqual(new Set());
  });
});

describe("decode with refs", () => {
  it("restores identity through refs and closes cycles", () => {
    const shared = { v: 1 };
    const cycle: { self?: unknown; list?: unknown[] } = {};
    cycle.self = cycle;
    cycle.list = [cycle, shared, shared];
    const out = decode(encode(cycle).json) as typeof cycle;
    expect(out.self).toBe(out);
    expect(out.list?.[0]).toBe(out);
    expect(out.list?.[1]).toBe(out.list?.[2]);
  });

  it("leaves markers without a runtime form and unknown tags as plain objects", () => {
    expect(decode({ $type: "truncated" })).toEqual({ $type: "truncated" });
    expect(decode({ $type: "function", name: "f" })).toEqual({ $type: "function", name: "f" });
    expect(decode({ $type: "error", name: "E", message: "m" })).toEqual({
      $type: "error",
      name: "E",
      message: "m",
    });
    expect(decode({ $type: "mystery", x: 1 })).toEqual({ $type: "mystery", x: 1 });
    expect(decode({ $type: "toString", x: 1 })).toEqual({ $type: "toString", x: 1 });
    expect(decode({ $type: "constructor" })).toEqual({ $type: "constructor" });
    expect(decode({ $class: "Price", amount: 1 })).toEqual({ $class: "Price", amount: 1 });
  });

  it("leaves a ref it cannot resolve as it is", () => {
    const dangling = { $type: "ref", path: ["nowhere", 0] };
    expect(decode({ a: dangling })).toEqual({ a: dangling });
    expect(decode({ a: 1, r: { $type: "ref", path: ["a"] } })).toEqual({
      a: 1,
      r: { $type: "ref", path: ["a"] },
    });
    expect(decode({ $type: "ref" })).toEqual({ $type: "ref" });
  });
});

describe("decode of keys", () => {
  it("strips the $$ key escape", () => {
    expect(decode({ $$type: "user", $$: 1, plain: [{ $$class: "x" }] })).toEqual({
      $type: "user",
      $: 1,
      plain: [{ $class: "x" }],
    });
  });
});
