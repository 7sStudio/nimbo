// Tests the descriptor reads of 04-kernel §3.3 and §6: what reading a property would find, an own or an inherited data
// property, an accessor, a Proxy on the chain or nothing, without running a getter or a trap; the kernel's descriptors
// prototype-free, so a polluted Object.prototype cannot turn one into another; and the comparisons by which the kernel
// knows a replacement it kept: the same value, getter or Proxy, in the same descriptor.
import { describe, expect, it } from "vitest";

import {
  bare,
  findProperty,
  holdsValue,
  isAccessor,
  ownDescriptor,
  sameDescriptor,
  sameFound,
} from "./descriptors.js";

/** Counts the calls of the traps and getters below, which must never run. */
let touched = 0;
const touch = (): never => {
  touched += 1;
  throw new Error("a getter or trap ran");
};

/** An empty object over `prototype`. */
function over(prototype: object): object {
  const object = {};
  Reflect.setPrototypeOf(object, prototype);
  return object;
}

describe("findProperty", () => {
  it("finds an own or inherited data property, an accessor and nothing, calling no getter", () => {
    touched = 0;
    const target = Object.defineProperties(over({ inherited: 1 }), {
      own: { value: 2 },
      getter: { get: touch, configurable: true },
    });
    expect([
      findProperty(target, "own"),
      findProperty(target, "inherited"),
      findProperty(target, "getter"),
      findProperty(target, "missing"),
    ]).toEqual([
      { kind: "data", value: 2 },
      { kind: "data", value: 1 },
      { kind: "accessor", get: touch },
      { kind: "absent" },
    ]);
    expect(touched).toBe(0);
  });

  it("stops at a Proxy on the chain, or as the target, running none of its traps", () => {
    touched = 0;
    const proxy = new Proxy(
      {},
      { getOwnPropertyDescriptor: touch, getPrototypeOf: touch, get: touch },
    );
    const found = [findProperty(over(proxy), "emit"), findProperty(proxy, "emit")];
    // Compared by identity: a deep comparison would read the Proxy, and run its traps.
    expect(found.map((one) => (one.kind === "proxy" ? one.proxy === proxy : one.kind))).toEqual([
      true,
      true,
    ]);
    expect(touched).toBe(0);
  });
});

describe("holdsValue", () => {
  it("tells a value held in a data property from the same value behind a getter", () => {
    const value = (): undefined => undefined;
    const data = { hook: value };
    const accessor = Object.defineProperty({}, "hook", { get: () => value });
    expect([holdsValue(data, "hook", value), holdsValue(accessor, "hook", value)]).toEqual([
      true,
      false,
    ]);
  });
});

describe("the kernel's descriptors", () => {
  it("have no prototype, so a polluted Object.prototype.get cannot make a data descriptor invalid", () => {
    const target = {};
    let defined = false;
    let prototype: unknown = Object.prototype;
    // Nothing but the kernel's calls runs while Object.prototype has a `get`: the test runner's own calls would fail.
    Reflect.defineProperty(Object.prototype, "get", bare({ value: touch, configurable: true }));
    try {
      defined = Reflect.defineProperty(target, "x", bare({ value: 1, writable: true }));
      prototype = Reflect.getPrototypeOf(ownDescriptor(target, "x") ?? {});
    } finally {
      Reflect.deleteProperty(Object.prototype, "get");
    }
    expect([defined, prototype]).toEqual([true, null]);
  });

  it("are read as accessors only by their own keys", () => {
    const getter = Object.getOwnPropertyDescriptor(
      Object.defineProperty({}, "x", { get: () => 1 }),
      "x",
    );
    expect([isAccessor(getter), isAccessor({ value: 1 }), isAccessor(undefined)]).toEqual([
      true,
      false,
      false,
    ]);
  });
});

describe("sameFound", () => {
  it("tells the same value, getter or Proxy from another one, and nothing from something", () => {
    const [one, two] = [(): undefined => undefined, (): undefined => undefined];
    const proxy = new Proxy({}, { get: touch, getOwnPropertyDescriptor: touch });
    const finds = [
      { kind: "data", value: one },
      { kind: "accessor", get: one },
      { kind: "proxy", proxy },
      { kind: "absent" },
    ] as const;
    expect(finds.map((found) => sameFound(found, found))).toEqual([true, true, true, true]);
    expect(finds.map((found) => sameFound(found, { kind: "data", value: two }))).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(sameFound({ kind: "proxy", proxy }, { kind: "proxy", proxy: new Proxy({}, {}) })).toBe(
      false,
    );
  });
});

describe("sameDescriptor", () => {
  it("tells descriptors apart by their value, accessors or any attribute, and none from one", () => {
    const value = (): undefined => undefined;
    const target = Object.defineProperties(
      {},
      {
        data: { value, writable: true, configurable: true },
        locked: { value },
        getter: { get: value, configurable: true },
        both: { get: value, set: value, configurable: true },
      },
    );
    const own = (key: string) => ownDescriptor(target, key);
    expect(sameDescriptor(own("data"), ownDescriptor({ data: value }, "data"))).toBe(false);
    expect(
      [own("data"), own("locked"), own("getter"), own("both")].map((a) => sameDescriptor(a, a)),
    ).toEqual([true, true, true, true]);
    expect([
      sameDescriptor(own("data"), own("locked")),
      sameDescriptor(own("getter"), own("both")),
      sameDescriptor(own("data"), undefined),
      sameDescriptor(undefined, undefined),
    ]).toEqual([false, false, false, true]);
  });
});
