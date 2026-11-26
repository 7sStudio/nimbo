// The any-depth rules (scoped references, calls, shorthand, typeof, dynamic import, nested var) on the generated text.
import { beforeAll, describe, expect, it } from "vitest";

import { analyze, transform } from "./index.js";

const filename = "jsnb:///rules.jsnb/c_2.ts";
/** The generated code, with the analysis checked against `analyze` on every input (one classifier). */
const code = (source: string): string => {
  const result = transform(source, { filename });
  expect(analyze(source)).toEqual(result.analysis);
  return result.code;
};

beforeAll(() => {
  transform("1", { filename });
});

describe("free identifiers", () => {
  it("rewrites reads and every kind of write onto __scope", () => {
    const out = code("x = y\nx++\nx += 1;\n[x] = e;\n({ x } = e);\nfor (x of e) {}");
    expect(out).toContain("__scope.x = __scope.y;");
    expect(out).toContain("__scope.x++;");
    expect(out).toContain("__scope.x += 1;");
    expect(out).toContain("[__scope.x] = __scope.e;");
    expect(out).toContain("({ x: __scope.x } = __scope.e);");
    expect(out).toContain("for (__scope.x of __scope.e) {");
  });

  it("leaves property names, string and numeric keys and private members alone", () => {
    const out = code(
      'o.x\no?.x\nconst p = { x: 1, "y": 2, 3: 3 }\nclass C { #x = 1; get() { return this.#x } }',
    );
    expect(out).toContain("__scope.o.x;\n    __scope.o?.x;");
    expect(out).toContain('__scope.p = { x: 1, "y": 2, 3: 3 };');
    expect(out).toContain("#x = 1;");
    expect(out).toContain("this.#x");
  });

  it("leaves labels, import.meta, undefined and arguments alone", () => {
    const out = code(
      "outer: for (;;) { break outer }\nconst m = import.meta.url\nconst u = undefined\nfunction f() { return arguments }",
    );
    expect(out).toContain("outer: for (;;) {\n        break outer;");
    expect(out).toContain("__scope.m = import.meta.url;");
    expect(out).toContain("__scope.u = undefined;");
    expect(out).toContain("return arguments;");
  });
});

describe("declared names", () => {
  it("leaves names declared below top level alone, at any depth", () => {
    const out = code(
      "function f(p) { let l = p; for (const i of [l]) { class K { m() { return i } } } try {} catch (e) { return e } return l }",
    );
    expect(out.replace("__scope.f = function f(p)", "")).not.toContain("__scope.");
  });

  it("rewrites names declared at top level wherever they are read", () => {
    const out = code("let n = 1\nfunction f() { return () => n++ }");
    expect(out).toContain("return () => __scope.n++;");
  });

  it("sends globalThis through the scope and routes a nested block's let and const nowhere", () => {
    const out = code("const g = globalThis\n{ let a = 1; const b = 2; a + b }");
    expect(out).toContain("__scope.g = __scope.globalThis;");
    expect(out).toContain("let a = 1;\n        const b = 2;\n        a + b;");
  });
});

describe("calls", () => {
  it("calls a scoped function through (0, __scope.f) so this is undefined", () => {
    expect(code("f(a)\nfetch(url)\n0")).toContain(
      "(0, __scope.f)(__scope.a);\n    (0, __scope.fetch)(__scope.url);",
    );
  });

  it("keeps optional calls and tagged templates on the comma form", () => {
    expect(code("f?.(a)")).toContain("return ((0, __scope.f)?.(__scope.a));");
    expect(code("f`x${y}`")).toContain("return ((0, __scope.f) `x${__scope.y}`);");
  });

  it("uses the plain member form for new and for calls on members", () => {
    expect(code("new C(a)\no.m(a)\nconst g = function h() { return h() }")).toContain(
      "new __scope.C(__scope.a);\n    __scope.o.m(__scope.a);\n    __scope.g = function h() { return h(); };",
    );
  });

  it("rewrites dynamic import anywhere to __scope.__import and leaves import.meta", () => {
    const out = code('const m = await import("p")\nfunction f(s) { return import(s) }');
    expect(out).toContain('__scope.m = await __scope.__import("p");');
    expect(out).toContain("return __scope.__import(s);");
  });
});

describe("shorthand properties", () => {
  it("expands a scoped shorthand read and leaves a local one", () => {
    expect(code("const o = { x, y }\nfunction f(l) { return { l } }")).toContain(
      "__scope.o = { x: __scope.x, y: __scope.y };",
    );
    expect(code("function f(l) { return { l } }")).toContain("return { l };");
  });

  it("expands a shorthand assignment target, keeping its default", () => {
    expect(code("({ x, y = 1 } = o)")).toContain(
      "({ x: __scope.x, y: __scope.y = 1 } = __scope.o)",
    );
  });
});

describe("typeof", () => {
  it("peeks a scoped name so an unknown name does not throw", () => {
    expect(code("typeof x\nconst d = 1\ntypeof d")).toContain(
      'typeof __scope.$peek("x");\n    __scope.d = 1;\n    return (typeof __scope.$peek("d"));',
    );
  });

  it("leaves typeof of a local and typeof of an expression alone", () => {
    expect(code("function f(l) { return typeof l }\ntypeof o.x")).toContain("return typeof l;");
    expect(code("typeof o.x")).toContain("return (typeof __scope.o.x);");
  });
});

describe("nested var", () => {
  it("assigns var in a top-level block, if, for, for-in and for-of onto __scope", () => {
    const out = code(
      "{ var a = 1, b }\nif (c) var d = 2\nfor (var i = 0; i < 2; i++) {}\nfor (var k in o) {}\nfor (var v of o) {}\nfor (var [p, q] of o) {}",
    );
    expect(out).toContain("__scope.a = 1, __scope.b = undefined;");
    expect(out).toContain("if (__scope.c)\n        __scope.d = 2;");
    expect(out).toContain("for (__scope.i = 0; __scope.i < 2; __scope.i++) {");
    expect(out).toContain("for (__scope.k in __scope.o) {");
    expect(out).toContain("for (__scope.v of __scope.o) {");
    expect(out).toContain("for ([__scope.p, __scope.q] of __scope.o) {");
  });

  it("leaves var inside a nested function local", () => {
    const out = code("function f() { var l = 1; for (var i = 0;;) {} return l + i }");
    expect(out).toContain("var l = 1;");
    expect(out).not.toMatch(/__scope\.[li]\b/);
  });
});
