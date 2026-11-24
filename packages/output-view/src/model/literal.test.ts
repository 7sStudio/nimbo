// Tests literal.ts: "copy as JavaScript literal"; the source rebuilds the value, checked by running it.
import { runInThisContext } from "node:vm";

import { encode } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { valueCases } from "./fixtures/values.js";
import { toLiteral } from "./literal.js";
import { children, isContainer, kindOf } from "./wire.js";

const hasKind = (json: unknown, kinds: ReadonlySet<string>): boolean => {
  const kind = kindOf(json);
  return (
    kinds.has(kind) ||
    (isContainer(kind) && children(json, kind).some((child) => hasKind(child.node, kinds)))
  );
};
const unrebuildable = new Set(["ref", "truncated", "instance"]);
const rebuildable = valueCases.filter((c) => !hasKind(c.json, unrebuildable));

describe("toLiteral rebuilds", () => {
  it.each(rebuildable)("$name, which encodes back to the same wire form", ({ json }) => {
    const rebuilt: unknown = runInThisContext(`(${toLiteral(json)})`);
    expect(JSON.parse(JSON.stringify(encode(rebuilt).json))).toEqual(json);
  });
});

describe("toLiteral", () => {
  it("writes keys bare when they are identifiers, quoted otherwise, __proto__ computed", () => {
    expect(toLiteral(JSON.parse('{ "a": 1, "b c": 2, "$$x": 3, "__proto__": 4 }'))).toBe(
      '{\n  a: 1,\n  "b c": 2,\n  $x: 3,\n  ["__proto__"]: 4,\n}',
    );
  });

  it("labels instances and notes what it cannot rebuild", () => {
    expect(toLiteral({ $class: "Price", amount: 1 })).toBe("/* Price */ {\n  amount: 1,\n}");
    expect(toLiteral({ self: { $type: "ref", path: [] }, cut: { $type: "truncated" } })).toBe(
      "{\n  self: undefined /* circular → $ */,\n  cut: undefined /* truncated */,\n}",
    );
    expect(toLiteral({ $class: "A*/B" })).toBe("/* A* /B */ {}");
  });

  it("writes errors, functions, regexps and partial bytes", () => {
    expect(toLiteral({ $type: "error", name: "StripeError", message: "x" })).toBe(
      'Object.assign(new Error("x"), { name: "StripeError" })',
    );
    expect([
      toLiteral({ $type: "function", name: "bound f" }),
      toLiteral({ $type: "regexp", source: "", flags: "" }),
    ]).toEqual(["function () {}", "/(?:)/"]);
    expect(toLiteral({ $type: "bytes", length: 10, base64: "aGk=" })).toBe(
      "/* the first 2 of 10 bytes */ new Uint8Array([104, 105])",
    );
    expect(toLiteral({ $type: "date" })).toBe("new Date(NaN)");
  });

  it("writes a repeated object until the budget, then a note", () => {
    const value = { a: [1], b: { $type: "ref", path: ["a"] }, c: { $type: "ref", path: ["a"] } };
    expect(toLiteral(value, value, 4)).toBe(
      "{\n  a: [\n    1,\n  ],\n  b: [\n    1,\n  ],\n  c: undefined /* ref → $.a */,\n}",
    );
  });
});
