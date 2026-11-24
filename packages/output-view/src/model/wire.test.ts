// Tests wire.ts: kinds, children and refs of core's wire form, malformed markers included.
import { describe, expect, it } from "vitest";

import {
  childCount,
  children,
  fieldKeys,
  isContainer,
  kindOf,
  refTarget,
  resolve,
  textField,
} from "./wire.js";

const scalars: readonly (readonly [unknown, string])[] = [
  ["a", "string"],
  [1, "number"],
  [true, "boolean"],
  [null, "null"],
  [[], "array"],
  [{}, "object"],
  [{ $type: "future" }, "object"],
  [{ $class: "Price" }, "instance"],
  [{ $class: 1 }, "object"],
  [undefined, "undefined"],
  [Symbol("s"), "undefined"],
];

const markers: readonly (readonly [string, string])[] = [
  ["undefined", "undefined"],
  ["number", "special"],
  ["bigint", "bigint"],
  ["date", "date"],
  ["regexp", "regexp"],
  ["function", "function"],
  ["error", "error"],
  ["bytes", "bytes"],
  ["ref", "ref"],
  ["truncated", "truncated"],
  ["map", "map"],
  ["set", "set"],
];

describe("kindOf", () => {
  it.each(scalars)("reads %o as %s", (node, kind) => {
    expect(kindOf(node)).toBe(kind);
  });

  it.each(markers)("reads a %s marker as %s", ($type, kind) => {
    expect(kindOf({ $type })).toBe(kind);
  });
});

describe("isContainer", () => {
  it("is true for objects, instances, arrays, Maps and Sets only", () => {
    expect(
      (["object", "instance", "array", "map", "set", "string", "bytes", "ref"] as const).map(
        isContainer,
      ),
    ).toEqual([true, true, true, true, true, false, false, false]);
  });
});

describe("childCount", () => {
  it("counts keys, items, entries and members, and nothing for a leaf", () => {
    expect(childCount({ $class: "P", a: 1, b: 2 }, "instance")).toBe(2);
    expect(childCount([1, 2, 3], "array")).toBe(3);
    expect(childCount({ $type: "map", entries: [[1, 2]] }, "map")).toBe(1);
    expect(childCount({ $type: "set", values: [1, 2] }, "set")).toBe(2);
    expect(childCount({ $type: "set", values: "no" }, "set")).toBe(0);
    expect(childCount("text", "string")).toBe(0);
    expect(childCount("not an array", "array")).toBe(0);
  });
});

describe("children", () => {
  it("addresses array items by index", () => {
    expect(children(["a", "b"], "array")).toEqual([
      { key: { kind: "index", index: 0 }, segments: [0], node: "a" },
      { key: { kind: "index", index: 1 }, segments: [1], node: "b" },
    ]);
  });

  it("addresses Map values as entries[i][1] with their key node", () => {
    expect(children({ $type: "map", entries: [["k", 1], "broken"] }, "map")).toEqual([
      { key: { kind: "entry", node: "k" }, segments: ["entries", 0, 1], node: 1 },
      { key: { kind: "entry", node: undefined }, segments: ["entries", 1, 1], node: undefined },
    ]);
  });

  it("addresses Set members as values[i]", () => {
    expect(children({ $type: "set", values: [7] }, "set")).toEqual([
      { key: { kind: "member" }, segments: ["values", 0], node: 7 },
    ]);
  });

  it("names object fields unescaped and keeps the wire key as the segment", () => {
    expect(children({ $$type: "user", $class: "P" }, "instance")).toEqual([
      { key: { kind: "name", name: "$type" }, segments: ["$$type"], node: "user" },
    ]);
  });

  it("stops at the limit", () => {
    expect(children([1, 2, 3], "array", 2)).toHaveLength(2);
    expect(children({ a: 1, b: 2 }, "object", 1)).toHaveLength(1);
  });

  it("finds nothing in a non-object", () => {
    expect([children("x", "object"), fieldKeys(3, "object")]).toEqual([[], []]);
  });
});

describe("textField", () => {
  it("reads a string field and ignores any other type", () => {
    expect([
      textField({ name: "f" }, "name"),
      textField({ name: 1 }, "name"),
      textField("x", "name"),
    ]).toEqual(["f", undefined, undefined]);
  });
});

describe("resolve", () => {
  const root = { a: [{ b: "deep" }], m: { $type: "map", entries: [["k", "v"]] } };

  it("follows keys and indexes from the root", () => {
    expect(resolve(root, ["a", 0, "b"])).toEqual({ node: "deep" });
    expect(resolve(root, ["m", "entries", 0, 1])).toEqual({ node: "v" });
    expect(resolve(root, [])).toEqual({ node: root });
  });

  it("is undefined when a segment leads nowhere", () => {
    expect([
      resolve(root, ["missing"]),
      resolve(root, ["a", 0, "b", "c"]),
      resolve(root, ["a", 5]),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe("refTarget", () => {
  it("reads a ref's path and refuses a malformed one", () => {
    expect(refTarget({ $type: "ref", path: ["a", 0] })).toEqual(["a", 0]);
    expect([
      refTarget({ $type: "ref", path: "a" }),
      refTarget({ $type: "ref", path: [{}] }),
      refTarget(3),
    ]).toEqual([undefined, undefined, undefined]);
  });
});
