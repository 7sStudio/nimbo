// Tests encodeStrict: plain data passes, the first non-plain value fails with its path and type.
import { describe, expect, it } from "vitest";

import { encodeStrict } from "./encode.js";

class Stripe {
  readonly key = "sk";
}

describe("encodeStrict", () => {
  it("accepts plain data with cycles and every plain kind", () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const value = [
      null,
      undefined,
      true,
      1,
      2n,
      "s",
      { cycle },
      new Date(0),
      new Map(),
      new Set(),
      /x/,
      new Uint8Array(2),
    ];
    const result = encodeStrict(value);
    expect(result.ok).toBe(true);
    const json = result.ok && Array.isArray(result.json) ? result.json : [];
    expect(json).toHaveLength(value.length);
    expect(json[1]).toEqual({ $type: "undefined" });
  });

  it("refuses a class instance with its path and constructor name", () => {
    expect(encodeStrict({ args: [1, { client: new Stripe() }] })).toEqual({
      ok: false,
      error: { path: ["args", 1, "client"], type: "Stripe" },
    });
  });

  it("refuses functions and errors", () => {
    expect(encodeStrict([() => 1])).toEqual({ ok: false, error: { path: [0], type: "Function" } });
    expect(encodeStrict(new TypeError("x"))).toEqual({
      ok: false,
      error: { path: [], type: "TypeError" },
    });
  });
});

describe("encodeStrict on edge cases", () => {
  it("names Object for an instance whose prototype has no constructor name", () => {
    const proto = Object.create(Object.create(null) as object) as object;
    const result = encodeStrict({ x: Object.create(proto) as object });
    expect(result).toEqual({ ok: false, error: { path: ["x"], type: "Object" } });
  });

  it("carries bytes whole up to maxBytesPerValue and refuses beyond", () => {
    const bytes = new Uint8Array(4);
    const ok = encodeStrict(bytes, { maxBytesPerValue: 4 });
    expect(ok).toEqual({ ok: true, json: { $type: "bytes", length: 4, base64: "AAAAAA==" } });
    expect(encodeStrict({ b: new Uint8Array(5) }, { maxBytesPerValue: 4 })).toEqual({
      ok: false,
      error: { path: ["b"], type: "Uint8Array", bytes: 5 },
    });
  });

  it("names bytes over the limit by their own class and counts their bytes", () => {
    const over = (value: unknown) => encodeStrict(value, { maxBytesPerValue: 4 });
    expect(over(new Float64Array(2))).toEqual({
      ok: false,
      error: { path: [], type: "Float64Array", bytes: 16 },
    });
    expect(over(new ArrayBuffer(8))).toMatchObject({ error: { type: "ArrayBuffer", bytes: 8 } });
    expect(over(new DataView(new ArrayBuffer(6)))).toMatchObject({
      error: { type: "DataView", bytes: 6 },
    });
  });

  it("reports the first failure only and applies no budgets", () => {
    const deep = Array.from({ length: 30 }).reduce<unknown>((inner) => [inner], 0);
    expect(encodeStrict(deep).ok).toBe(true);
    const result = encodeStrict([new Stripe(), () => 1]);
    expect(!result.ok && result.error.type).toBe("Stripe");
  });

  it("redacts strings", () => {
    const result = encodeStrict({ secret: "sk_test_1" }, { redact: () => "***" });
    expect(result).toEqual({ ok: true, json: { "***": "***" } });
  });
});
