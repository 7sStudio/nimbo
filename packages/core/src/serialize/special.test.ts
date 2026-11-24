// Tests kindOf and className over every kind the serializer distinguishes.
import { describe, expect, it } from "vitest";

import { className, kindOf } from "./special.js";

class Thing {
  readonly id = 1;
}

describe("kindOf", () => {
  it.each([
    ["s", "primitive"],
    [1, "primitive"],
    [null, "primitive"],
    [true, "primitive"],
    [undefined, "undefined"],
    [Number.NaN, "specialNumber"],
    [-0, "specialNumber"],
    [Number.POSITIVE_INFINITY, "specialNumber"],
    [1n, "bigint"],
    [Symbol("s"), "symbol"],
    [() => 1, "function"],
    [new Date(0), "date"],
    [/x/, "regexp"],
    [new Error("e"), "error"],
    [new Uint8Array(1), "bytes"],
    [new ArrayBuffer(1), "bytes"],
    [[], "array"],
    [new Map(), "map"],
    [new Set(), "set"],
    [{}, "plain"],
    [Object.create(null), "plain"],
    [new Thing(), "instance"],
  ])("classifies %s as %s", (value, kind) => {
    expect(kindOf(value)).toBe(kind);
  });
});

describe("className", () => {
  it("reads the constructor name and falls back to Object", () => {
    expect(className(new Thing())).toBe("Thing");
    expect(className(new Uint8Array(0))).toBe("Uint8Array");
    expect(className(Object.create(null) as object)).toBe("Object");
    expect(className(Object.create(Object.create(null) as object) as object)).toBe("Object");
    expect(className(Object.create({ constructor: 1 }) as object)).toBe("Object");
  });
});
