// Tests the scope object: lookup order, creation reports, unshadowable plumbing, clean globals.
import vm from "node:vm";

import { describe, expect, it } from "vitest";

import type { Plumbing } from "./record.js";
import { createScope } from "./record.js";

const plumbing: Plumbing = {
  __import: () => Promise.resolve({}),
  __export: () => undefined,
};

const scopeWith = (builtins: Record<string, unknown> = {}) => {
  const created: string[] = [];
  const scope = createScope({ builtins, plumbing, onCreate: (name) => created.push(name) });
  return { ...scope, created };
};

type CellFunction = (scope: Record<string, unknown>) => unknown;
const isCellFunction = (value: unknown): value is CellFunction => typeof value === "function";

/** Runs code the way a compiled cell does: a strict function of `__scope`. */
const cell = (code: string): CellFunction => {
  const fn: unknown = vm.runInThisContext(`(__scope) => { "use strict"; ${code} }`);
  if (!isCellFunction(fn)) throw new Error("not a function");
  return fn;
};

describe("createScope writes", () => {
  it("defines a written name as an own enumerable property and reports only its creation", () => {
    const { record, created, names } = scopeWith();
    cell("__scope.a = 1; __scope.a = 2; __scope.b = __scope.a + 1;")(record);
    expect(Object.getOwnPropertyDescriptor(record, "a")).toEqual({
      value: 2,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect(created).toEqual(["a", "b"]);
    expect(names()).toEqual(["a", "b"]);
  });

  it("lets a cell shadow a built-in without reporting a creation or touching the layer", () => {
    const { record, created } = scopeWith({ display: "builtin" });
    cell("__scope.display = 1;")(record);
    expect(created).toEqual([]);
    expect(Object.hasOwn(record, "display")).toBe(true);
    expect(Reflect.get(Reflect.getPrototypeOf(record) ?? {}, "display")).toBe("builtin");
  });

  it("writes nothing to globalThis", () => {
    const { record } = scopeWith();
    cell("__scope.scopeOnlyName = 1; __scope.fetch = 'mine';")(record);
    expect("scopeOnlyName" in globalThis).toBe(false);
    expect(typeof fetch).toBe("function");
    expect(record.fetch).toBe("mine");
  });
});

describe("createScope reads", () => {
  it("looks a name up in the record, then the built-ins, then the realm's globals", () => {
    const { record } = scopeWith({ env: "builtin", Math: "shadowed global" });
    expect(cell("return [__scope.env, __scope.Math, __scope.JSON === JSON];")(record)).toEqual([
      "builtin",
      "shadowed global",
      true,
    ]);
    cell("__scope.env = 'cell';")(record);
    expect(record.env).toBe("cell");
  });

  it("throws ReferenceError for a name that exists nowhere", () => {
    const { record } = scopeWith();
    expect(() => cell("return __scope.nowhere;")(record)).toThrow(
      new ReferenceError("nowhere is not defined"),
    );
  });

  it("answers undefined for symbols and has by the realm's globals", () => {
    const { record } = scopeWith();
    expect(Reflect.get(record, Symbol.iterator)).toBeUndefined();
    expect("setTimeout" in record).toBe(true);
    expect("nowhere" in record).toBe(false);
  });
});

describe("createScope plumbing", () => {
  it("keeps the plumbing own, hidden and unshadowable", () => {
    const { record, names } = scopeWith({ __export: "builtin" });
    expect(typeof record.__export).toBe("function");
    expect(() => cell("__scope.__import = 1;")(record)).toThrow(TypeError);
    expect(names()).toEqual([]);
  });

  it("reports a creation only for writes whose receiver is the record", () => {
    const { record, created } = scopeWith();
    const child: Record<string, unknown> = {};
    Reflect.setPrototypeOf(child, record);
    child.viaChild = 1;
    expect(Object.hasOwn(child, "viaChild")).toBe(true);
    expect(created).toEqual([]);
  });
});

describe("peek", () => {
  it("reads the record, the built-ins and the globals, and never throws", () => {
    const { record, peek } = scopeWith({ env: "builtin" });
    record.own = 7;
    expect([peek("own"), peek("env"), peek("JSON"), peek("nowhere")]).toEqual([
      7,
      "builtin",
      JSON,
      undefined,
    ]);
    expect(cell('return typeof __scope.$peek("nowhere");')(record)).toBe("undefined");
  });
});
