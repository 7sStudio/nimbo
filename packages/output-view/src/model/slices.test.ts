// Tests slices.ts: where "load more" applies and how a loaded slice replaces the kernel's truncated marker.
import { describe, expect, it } from "vitest";

import { loadLimit, moreAt, spliceSlice } from "./slices.js";

const cut = { $type: "truncated" };
const value = { data: [1, 2, cut], meta: { a: 1, b: cut } };

describe("moreAt", () => {
  it("finds the offset of a trailing marker in an array or an object", () => {
    expect([
      moreAt(value, ["data"]),
      moreAt(value, ["meta"]),
      moreAt(value, []),
      moreAt(value, ["missing"]),
    ]).toEqual([{ offset: 2 }, { offset: 1 }, undefined, undefined]);
    expect(loadLimit).toBe(2000);
  });
});

describe("spliceSlice", () => {
  it("puts the loaded items in place of the marker and keeps one while more remain", () => {
    expect(spliceSlice(value, ["data"], 2, { json: [3, 4], total: 9, truncated: true })).toEqual({
      data: [1, 2, 3, 4, cut],
      meta: value.meta,
    });
    expect(spliceSlice([0, cut], [], 1, { json: [1], total: 2, truncated: false })).toEqual([0, 1]);
  });

  it("merges loaded keys into an object, copies the containers on the way and leaves the input alone", () => {
    const next = spliceSlice({ rows: [{ m: { a: 1, b: cut } }] }, ["rows", 0, "m"], 1, {
      json: { b: 2, c: 3 },
      total: 3,
      truncated: false,
    });
    expect(next).toEqual({ rows: [{ m: { a: 1, b: 2, c: 3 } }] });
    expect(value.data).toHaveLength(3);
  });

  it("leaves a value alone when the path leads nowhere or the slice is not a list", () => {
    expect(spliceSlice(value, ["nope", 0], 0, { json: [], total: 0, truncated: false })).toEqual(
      value,
    );
    expect(spliceSlice("x", [], 0, { json: [], total: 0, truncated: false })).toBe("x");
    expect(spliceSlice([cut], [], 0, { json: "bad", total: 0, truncated: false })).toEqual([]);
  });
});
