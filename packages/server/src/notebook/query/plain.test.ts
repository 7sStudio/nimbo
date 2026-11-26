// The rows SQL mode loads follow output-view's plain rules (model/plain.test.ts holds the same cases), so
// `t` is the same table on the page and on the daemon.
import { describe, expect, it } from "vitest";

import { toPlain } from "./plain.js";

const markers = {
  u: { $type: "undefined" },
  nan: { $type: "number", value: "NaN" },
  zero: { $type: "number", value: "-0" },
  big: { $type: "bigint", value: "12345678901234567890" },
  date: { $type: "date", iso: "2026-10-10T14:02:11.000Z" },
  bad: { $type: "date", iso: null },
  re: { $type: "regexp", source: "^a", flags: "g" },
  fn: { $type: "function", name: "f" },
  err: { $type: "error", name: "TypeError", message: "x" },
  bytes: { $type: "bytes", length: 2, base64: "aGk=" },
  cut: { $type: "truncated" },
};

describe("toPlain leaves", () => {
  it("writes what JSON.stringify of the live value would, and readable text for the rest", () => {
    expect(toPlain(markers)).toEqual({
      nan: null,
      zero: 0,
      big: "12345678901234567890",
      date: "2026-10-10T14:02:11.000Z",
      bad: null,
      re: "/^a/g",
      err: { name: "TypeError", message: "x" },
      bytes: "aGk=",
      cut: "[truncated]",
    });
    expect(toPlain([{ $type: "undefined" }, { $type: "function", name: "f" }])).toEqual([
      null,
      null,
    ]);
    expect(toPlain({ $type: "undefined" })).toBeUndefined();
  });

  it("defaults malformed markers", () => {
    const malformed = [
      { $type: "bigint" },
      { $type: "error" },
      { $type: "bytes" },
      { $type: "number", value: "1" },
    ];
    expect(toPlain(malformed)).toEqual(["0", { name: "Error", message: "" }, "", null]);
  });
});

describe("toPlain containers", () => {
  it("writes Maps with simple keys as objects, any other Map as pairs, Sets as arrays", () => {
    const simple = {
      $type: "map",
      entries: [
        ["a", 1],
        [2, { $type: "undefined" }],
        [3, "x"],
      ],
    };
    expect(toPlain(simple)).toEqual({ a: 1, 3: "x" });
    expect(toPlain({ $type: "map", entries: [[{ id: 1 }, "v"], "broken"] })).toEqual([
      [{ id: 1 }, "v"],
      [null, null],
    ]);
    expect(toPlain({ $type: "set", values: [1, { $type: "undefined" }] })).toEqual([1, null]);
  });

  it("drops an instance's $class, unescapes keys, keeps __proto__ as a key and an unknown marker's fields", () => {
    const plain = toPlain(JSON.parse('{ "$class": "P", "$$type": 1, "__proto__": { "x": 1 } }'));
    expect(JSON.stringify(plain)).toBe('{"$type":1,"__proto__":{"x":1}}');
    expect(Object.getPrototypeOf(plain)).toBe(Object.prototype);
    expect(toPlain({ $type: "future", $class: "C", a: 1 })).toEqual({
      $type: "future",
      $class: "C",
      a: 1,
    });
  });
});

describe("toPlain refs", () => {
  it("writes a repeated object in full and a cycle as a note", () => {
    expect(toPlain({ a: { id: 1 }, b: { $type: "ref", path: ["a"] } })).toEqual({
      a: { id: 1 },
      b: { id: 1 },
    });
    expect(toPlain({ name: "c", self: { $type: "ref", path: [] } })).toEqual({
      name: "c",
      self: "[Circular → $]",
    });
    expect(toPlain({ b: { $type: "ref", path: ["gone"] } })).toEqual({ b: "[Ref → $.gone]" });
    expect(toPlain({ "a b": [{ $type: "ref", path: ["a b"] }] })).toEqual({
      "a b": ["[Circular → $['a b']]"],
    });
  });

  it("stops inlining past the budget", () => {
    const many = {
      a: [1, 2, 3],
      b: { $type: "ref", path: ["a"] },
      c: { $type: "ref", path: ["a"] },
    };
    expect(toPlain(many, 8)).toEqual({ a: [1, 2, 3], b: [1, 2, 3], c: "[Ref → $.a]" });
  });
});
