// Rule 15 of 04 §3.2: TypeScript syntax is stripped or lowered by the emitter, never read as a value reference.
import { beforeAll, describe, expect, it } from "vitest";

import { analyze, transform } from "./index.js";

const filename = "jsnb:///rules.jsnb/c_4.ts";
/** The generated code, with the analysis checked against `analyze` on every input (one classifier). */
const code = (source: string): string => {
  const result = transform(source, { filename });
  expect(analyze(source)).toEqual(result.analysis);
  return result.code;
};

beforeAll(() => {
  transform("1", { filename });
});

describe("type stripping (rule 15)", () => {
  it("strips annotations, as, satisfies, angle-bracket assertions and non-null", () => {
    const out = code(
      "const a: number = b as number\nconst c = d satisfies string\nconst e = <string>f\nconst g = h!",
    );
    expect(out).toContain(
      "__scope.a = __scope.b;\n    __scope.c = __scope.d;\n    __scope.e = __scope.f;\n    __scope.g = __scope.h;",
    );
  });

  it("never rewrites a name inside a type position", () => {
    const out = code(
      "type T = typeof x\nconst a: T<Y> = 1\nfunction f<U extends V>(p: U): W { return p }",
    );
    expect(out).not.toContain("__scope.x");
    expect(out).not.toContain("__scope.Y");
    expect(out).not.toContain("__scope.V");
    expect(out).not.toContain("__scope.W");
  });

  it("lowers parameter properties and accessibility modifiers inside a class", () => {
    const out = code(
      "class C { constructor(private x: number, public readonly y = 2) {} protected m(): void {} }",
    );
    expect(out).toContain("this.x = x;");
    expect(out).toContain("this.y = y;");
    expect(out).not.toMatch(/\b(private|public|protected|readonly)\b/);
  });
});

describe("lowering (rule 15)", () => {
  it("lowers a decorated class and keeps the decorator's free name on the scope", () => {
    const out = code("@dec class C { @mark m() {} }");
    expect(out).toContain("__scope).dec.bind");
    expect(out).toContain("__scope).mark.bind");
    expect(out).not.toContain("@dec");
  });

  it("rewrites a free name under an instantiation expression", () => {
    expect(code("const g = make<string>")).toContain("__scope.g = (__scope.make);");
  });

  it("parses every form of top-level await as a module", () => {
    const out = code("await (p)\nawait [a]\nfor await (const x of s) {}");
    expect(out).toContain(
      "await (__scope.p);\n    await [__scope.a];\n    for await (const x of __scope.s) {",
    );
  });
});
