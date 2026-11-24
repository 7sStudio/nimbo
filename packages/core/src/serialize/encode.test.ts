// Tests encode: the corpus against its golden form, every limit, redaction over values and keys.
import { describe, expect, it } from "vitest";

import { encode } from "./encode.js";
import { corpus } from "./fixtures/values.js";
import values from "./fixtures/values.json" with { type: "json" };

const golden: Record<string, unknown> = values;

describe("encode", () => {
  it.each(corpus)("writes the golden form of $name", ({ name, value }) => {
    expect(JSON.parse(JSON.stringify(encode(value)))).toEqual(golden[name]);
  });

  it("covers every golden entry", () => {
    expect(Object.keys(golden).sort()).toEqual(corpus.map((c) => c.name).sort());
  });

  it("truncates containers past maxDepth and says so", () => {
    const deep = { a: { b: { c: 1 } } };
    expect(encode(deep, { maxDepth: 2 })).toEqual({
      json: { a: { b: { $type: "truncated" } } },
      truncated: true,
    });
    expect(encode(deep).truncated).toBe(false);
  });

  it("stops at maxNodes with one marker per open container", () => {
    const value = { list: [1, 2, 3, 4], after: "x" };
    const { json, truncated } = encode(value, { maxNodes: 4 });
    expect(truncated).toBe(true);
    expect(json).toEqual({ list: [1, 2, { $type: "truncated" }] });
  });

  it("stops at maxBytes, cutting the string that crosses the budget", () => {
    const { json, truncated } = encode(["a".repeat(50), "b".repeat(100), "c"], { maxBytes: 100 });
    expect(truncated).toBe(true);
    // 100 - (array 8 + "a" node 8 + 52 + "b" node 8) - 2 quotes = 22 characters of "b" fit.
    expect(json).toEqual(["a".repeat(50), "b".repeat(22)]);
  });
});

describe("encode in bytes", () => {
  it("counts escaped and non-ASCII strings in UTF-8 bytes and cuts between code points", () => {
    const bytes = (json: unknown) => new TextEncoder().encode(JSON.stringify(json)).length;
    const quotes = encode({ s: '"'.repeat(200_000) });
    expect(quotes.truncated).toBe(true);
    expect(bytes(quotes.json)).toBeLessThanOrEqual(262_144);
    const accents = encode({ s: "é".repeat(200_000) });
    expect(accents.truncated).toBe(true);
    expect(bytes(accents.json)).toBeLessThanOrEqual(262_144);
    const emoji = encode(["🙂".repeat(10)], { maxBytes: 8 + 8 + 2 + 9 });
    expect(emoji).toEqual({ json: ["🙂🙂"], truncated: true });
    expect(bytes(emoji.json)).toBeLessThanOrEqual(27);
    const control = encode(['\u0001\n\\"x'], { maxBytes: 8 + 8 + 2 + 10 });
    expect(control).toEqual({ json: ["\u0001\n\\"], truncated: true });
    expect(bytes(control.json)).toBeLessThanOrEqual(28);
    const lone = encode(["\ud83d\ud83d"], { maxBytes: 8 + 8 + 2 + 6 });
    expect(lone).toEqual({ json: ["\ud83d"], truncated: true });
  });

  it("never writes more than maxBytes, even for one huge string", () => {
    const { json, truncated } = encode({ s: "x".repeat(300_000) });
    expect(truncated).toBe(true);
    expect(JSON.stringify(json).length).toBeLessThanOrEqual(262_144);
    const key = encode({ ["k".repeat(300)]: 1 }, { maxBytes: 100 });
    expect(key.truncated).toBe(true);
    expect(JSON.stringify(key.json).length).toBeLessThanOrEqual(100);
  });
});

describe("encode with limits", () => {
  it("carries only bytesPreview bytes but reports the full length", () => {
    const bytes = new Uint8Array(100).fill(7);
    const { json } = encode(bytes, { bytesPreview: 3 });
    expect(json).toEqual({ $type: "bytes", length: 100, base64: "BwcH" });
  });

  it("redacts every string value, key and error message", () => {
    const redact = (text: string) => text.replaceAll("sk_test_123", "***");
    const { json } = encode(
      { sk_test_123: "sk_test_123", nested: [new Error("key sk_test_123 leaked")] },
      { redact },
    );
    expect(json).toEqual({
      "***": "***",
      nested: [{ $type: "error", name: "Error", message: "key *** leaked" }],
    });
  });
});

describe("encode with refs", () => {
  it("addresses refs by the written path, after escaping and redaction", () => {
    const shared = { v: 1 };
    const { json } = encode({ $k: shared, again: shared });
    expect(json).toEqual({ $$k: { v: 1 }, again: { $type: "ref", path: ["$$k"] } });
  });

  it("addresses refs inside maps and sets", () => {
    const shared = { v: 1 };
    const { json } = encode({ m: new Map([[shared, shared]]), s: new Set([shared]) });
    expect(json).toEqual({
      m: { $type: "map", entries: [[{ v: 1 }, { $type: "ref", path: ["m", "entries", 0, 0] }]] },
      s: { $type: "set", values: [{ $type: "ref", path: ["m", "entries", 0, 0] }] },
    });
  });
});
