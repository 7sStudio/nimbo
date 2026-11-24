// Tests plain.ts: the wire form as the plain JSON "copy as JSON" and the JSON exports write.
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
    expect(
      toPlain([
        { $type: "bigint" },
        { $type: "error" },
        { $type: "bytes" },
        { $type: "number", value: "1" },
      ]),
    ).toEqual(["0", { name: "Error", message: "" }, "", null]);
  });
});

describe("toPlain containers", () => {
  it("writes Maps with simple keys as objects, any other Map as pairs, Sets as arrays", () => {
    expect(
      toPlain({
        $type: "map",
        entries: [
          ["a", 1],
          [2, { $type: "undefined" }],
          [3, "x"],
        ],
      }),
    ).toEqual({ a: 1, 3: "x" });
    expect(toPlain({ $type: "map", entries: [[{ id: 1 }, "v"], "broken"] })).toEqual([
      [{ id: 1 }, "v"],
      [null, null],
    ]);
    expect(toPlain({ $type: "set", values: [1, { $type: "undefined" }] })).toEqual([1, null]);
  });

  it("drops an instance's $class, unescapes keys and keeps __proto__ as a key", () => {
    const plain = toPlain(JSON.parse('{ "$class": "P", "$$type": 1, "__proto__": { "x": 1 } }'));
    expect(JSON.stringify(plain)).toBe('{"$type":1,"__proto__":{"x":1}}');
    expect(Object.getPrototypeOf(plain)).toBe(Object.prototype);
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
  });

  it("resolves refs against the given root and stops inlining past the budget", () => {
    const root = { shared: { id: 9 }, rows: [{ $type: "ref", path: ["shared"] }] };
    expect(toPlain(root.rows, root)).toEqual([{ id: 9 }]);
    const many = {
      a: [1, 2, 3],
      b: { $type: "ref", path: ["a"] },
      c: { $type: "ref", path: ["a"] },
    };
    expect(toPlain(many, many, 8)).toEqual({ a: [1, 2, 3], b: [1, 2, 3], c: "[Ref → $.a]" });
  });
});
