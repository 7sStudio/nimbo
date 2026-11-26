// transform(): the result shape and the top-level rules (declarations, hoisting, classes, the last value).
import type { SourceMapPayload } from "node:module";
import { SourceMap } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { analyze, transform } from "./index.js";

const filename = "jsnb:///rules.jsnb/c_1.ts";
/** The generated code, with the analysis checked against `analyze` on every input (one classifier). */
const code = (source: string): string => {
  const result = transform(source, { filename });
  expect(analyze(source)).toEqual(result.analysis);
  return result.code;
};

beforeAll(() => {
  transform("1", { filename });
});

describe("transform result", () => {
  it("wraps the cell in a strict async arrow over __scope followed by the sourceURL and inline map", () => {
    const out = code("1");
    expect(out.startsWith('(async (__scope) => {\n    "use strict";\n')).toBe(true);
    expect(out).toMatch(
      /\n\}\);\n\/\/# sourceURL=jsnb:\/\/\/rules\.jsnb\/c_1\.ts\n\/\/# sourceMappingURL=data:application\/json;base64,[A-Za-z0-9+/=]+\n$/,
    );
  });

  it("emits an empty body with an empty analysis for an empty cell", () => {
    const result = transform("", { filename });
    expect(result.code.split("//# sourceURL")[0]).toBe(
      '(async (__scope) => {\n    "use strict";\n});\n',
    );
    expect(result.analysis).toEqual({ defines: [], uses: [], exports: [], imports: [], kinds: {} });
  });

  it("emits an empty body for a cell that only has comments", () => {
    expect(code("// just a note\n/* and a block */")).toContain('"use strict";\n});');
  });

  it("drops the ESM transformer's trailing export {} and the emitter's own map comment", () => {
    const out = code('import "p"');
    expect(out).not.toContain("export {}");
    expect(out.match(/sourceMappingURL/g)).toHaveLength(1);
  });
});

describe("source map of scoped names", () => {
  /** The original 1-based position of the generated column where `name` (after `__scope.`) starts. */
  const originOf = (source: string, name: string) => {
    const result = transform(source, { filename });
    const lines = result.code.split("\n");
    const line = lines.findIndex((text) => text.includes(`__scope.${name}`));
    const col = (lines[line] ?? "").indexOf(`__scope.${name}`) + "__scope.".length;
    // V8 reports a ReferenceError and a failed call on the name; node:module maps it the way the kernel does
    const payload: SourceMapPayload = JSON.parse(result.map) as SourceMapPayload;
    return new SourceMap(payload).findOrigin(line + 1, col + 1);
  };

  it("maps the name inside __scope.<name> to the name in the cell, not 8 columns past it", () => {
    expect(originOf("const q = 1;\nnope()", "nope")).toMatchObject({
      lineNumber: 2,
      columnNumber: 1,
    });
    expect(originOf("const q: number = 1; nope()", "nope")).toMatchObject({
      lineNumber: 1,
      columnNumber: 22,
    });
  });
});

describe("variable declarations", () => {
  it("assigns const, let and var onto __scope, one statement per declarator", () => {
    expect(code("const a = 1, b = 2\nlet c = 3\nvar d = 4")).toContain(
      "__scope.a = 1;\n    __scope.b = 2;\n    __scope.c = 3;\n    __scope.d = 4;",
    );
  });

  it("resets let x; and var x; to undefined", () => {
    expect(code("let x;\nvar y;")).toContain("__scope.x = undefined;\n    __scope.y = undefined;");
  });

  it("turns a binding pattern into an assignment pattern with __scope leaves", () => {
    expect(code("const { a, b: [c, d = 4], ...rest } = e")).toContain(
      "({ a: __scope.a, b: [__scope.c, __scope.d = 4], ...__scope.rest } = __scope.e);",
    );
  });

  it("keeps holes, nested patterns, computed keys and string keys in patterns", () => {
    const out = code('const [, x] = arr\nconst { [k]: v, "s-k": w, n: { m } } = o');
    expect(out).toContain("[, __scope.x] = __scope.arr");
    expect(out).toContain(
      '({ [__scope.k]: __scope.v, "s-k": __scope.w, n: { m: __scope.m } } = __scope.o)',
    );
  });
});

describe("functions", () => {
  it("hoists function declarations above everything else in source order", () => {
    const out = code(
      "const r = h()\nfunction h() { return g() }\nconst s = 2\nfunction g() { return 1 }",
    );
    const body = out.split("//# sourceURL")[0] ?? "";
    expect(body.indexOf("__scope.h = function h()")).toBeLessThan(
      body.indexOf("__scope.g = function g()"),
    );
    expect(body.indexOf("__scope.g = function g()")).toBeLessThan(body.indexOf("__scope.r ="));
    expect(body.indexOf("__scope.r =")).toBeLessThan(body.indexOf("__scope.s = 2"));
  });

  it("keeps async, generator and async generator modifiers", () => {
    const out = code("async function a() {}\nfunction* g() {}\nasync function* ag() {}");
    expect(out).toContain("__scope.a = async function a() { };");
    expect(out).toContain("__scope.g = function* g() { };");
    expect(out).toContain("__scope.ag = async function* ag() { };");
  });

  it("drops overload signatures and keeps the implementation", () => {
    const out = code(
      "function f(a: string): string\nfunction f(a: number): number\nfunction f(a: unknown) { return a }",
    );
    expect(out.match(/__scope\.f = function f/g)).toHaveLength(1);
  });

  it("hoists the __export of an exported function with it", () => {
    const out = code("const x = 1\nexport function f() {}");
    expect(out).toContain(
      '__scope.f = function f() { };\n    __scope.__export("f");\n    __scope.x = 1;',
    );
  });
});

describe("classes", () => {
  it("assigns a class in place, not hoisted", () => {
    const out = code("const before = 1\nclass C {}\nconst after = 2");
    expect(out).toContain(
      "__scope.before = 1;\n    __scope.C = class C {\n    };\n    __scope.after = 2;",
    );
  });

  it("drops export, abstract and declare from the class expression and exports it", () => {
    const out = code("export abstract class A { abstract m(): void }");
    expect(out).toContain('__scope.A = class A {\n    };\n    __scope.__export("A");');
    expect(out).not.toContain("abstract");
  });

  it("rewrites the extends expression but not the implements clause", () => {
    const out = code("class P extends Base implements Shape {}");
    expect(out).toContain("class P extends __scope.Base {");
    expect(out).not.toContain("Shape");
  });
});

describe("the last statement", () => {
  it("returns the value of a trailing expression statement, parenthesized", () => {
    expect(code("const a = 1\na + 1")).toContain("return (__scope.a + 1);");
  });

  it("returns nothing after a trailing declaration, if, loop or export", () => {
    for (const source of [
      "const a = 1",
      "if (x) { 1 }",
      "for (;;) {}",
      "const a = 1\nexport { a }",
    ]) {
      expect(code(source), source).not.toContain("return");
    }
  });

  it("ignores a trailing semicolon and a trailing comment when picking the last statement", () => {
    expect(code("1 + 1;;")).toContain("return (1 + 1);");
    expect(code("1 + 1 // note\n// another")).toContain("return (1 + 1);");
  });
});

describe("this at top level", () => {
  it("becomes void 0 at top level and inside top-level arrows", () => {
    expect(code("const t = this\nconst f = () => this")).toContain(
      "__scope.t = void 0;\n    __scope.f = { f: () => void 0 }.f;",
    );
  });

  it("stays inside functions, methods, class fields, static blocks and object methods", () => {
    const out = code(
      "function f() { return this }\nclass C { x = this; static { this } m() { return this } }\nconst o = { m() { return this } }",
    );
    expect(out).not.toContain("void 0");
    expect(out.match(/\bthis\b/g)).toHaveLength(5);
  });
});

describe("ambient and type-only statements", () => {
  it("drops declare statements, interfaces and type aliases silently", () => {
    const out = code(
      "declare const x: number\ndeclare enum E {}\ndeclare namespace N {}\ninterface I {}\ntype T = 1\n1",
    );
    expect(out).toContain('"use strict";\n    return (1);');
  });
});
