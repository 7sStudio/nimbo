// cell.outputValue's slice: children from offset up to limit, each within the byte budget and cut with
// core's truncated marker where it does not fit; a `__proto__` key stays a key.
import { truncatedMarker } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { nodeAt, sliceOf } from "./slice.js";

const all = { offset: 0, limit: 100 };

describe("sliceOf", () => {
  it("answers the children of an array or object from offset, at most limit, with the total", () => {
    expect(sliceOf([1, 2, 3, 4], { offset: 1, limit: 2 }, 1000)).toEqual({
      json: [2, 3],
      total: 4,
      truncated: true,
    });
    expect(sliceOf([1, 2], { offset: 1, limit: 5 }, 1000)).toEqual({
      json: [2],
      total: 2,
      truncated: false,
    });
    expect(sliceOf({ a: 1, b: 2, c: 3 }, { offset: 2, limit: 1 }, 1000)).toEqual({
      json: { c: 3 },
      total: 3,
      truncated: false,
    });
    expect(sliceOf("leaf", all, 1000)).toEqual({ json: "leaf", total: 0, truncated: false });
  });
});

describe("sliceOf's budget", () => {
  it("cuts what does not fit the budget with the truncated marker", () => {
    expect(sliceOf(["abcdef", "g"], all, 4)).toEqual({
      json: [truncatedMarker, truncatedMarker],
      total: 2,
      truncated: true,
    });
    expect(sliceOf([[1, 2, 3, 4, 5]], all, 6)).toEqual({
      json: [[1, 2, truncatedMarker]],
      total: 1,
      truncated: true,
    });
    expect(sliceOf([{ key: 1, other: 2 }], all, 10)).toEqual({
      json: [{ key: 1, other: truncatedMarker }],
      total: 1,
      truncated: true,
    });
    expect(sliceOf("too long", all, 3)).toEqual({
      json: truncatedMarker,
      total: 0,
      truncated: true,
    });
  });
});

describe("sliceOf's guards", () => {
  it("cuts below a depth of 32, and keeps a __proto__ key as an own key", () => {
    let deep: unknown = 1;
    for (let level = 0; level < 40; level += 1) deep = [deep];
    const cut = sliceOf(deep, all, 10_000);
    expect(JSON.stringify(cut.json)).toContain(JSON.stringify(truncatedMarker));
    expect(cut.truncated).toBe(true);
    const tricky: unknown = JSON.parse('{"__proto__": {"polluted": true}}');
    const kept = sliceOf([tricky], all, 1000).json;
    expect(Object.keys((kept as object[])[0] ?? {})).toEqual(["__proto__"]);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe("nodeAt", () => {
  it("follows own keys and indexes only", () => {
    const root = { a: [{ b: 1 }] };
    expect(nodeAt(root, ["a", 0, "b"])).toEqual({ node: 1 });
    expect(nodeAt(root, ["a", 1])).toBeUndefined();
    expect(nodeAt(root, ["toString"])).toBeUndefined();
    expect(nodeAt(1, ["a"])).toBeUndefined();
  });
});
