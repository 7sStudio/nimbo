// Every import and export form of 04 §3.2 (rules 6, 7 and 8) on the generated text and in the analysis.
import { beforeAll, describe, expect, it } from "vitest";

import { analyze, transform } from "./index.js";

const filename = "jsnb:///rules.jsnb/c_3.ts";
/** The result, with the analysis checked against `analyze` on every input (one classifier). */
const run = (source: string) => {
  const result = transform(source, { filename });
  expect(analyze(source)).toEqual(result.analysis);
  return result;
};
const body = (code: string): string => code.split("//# sourceURL")[0] ?? "";

beforeAll(() => {
  transform("1", { filename });
});

describe("imports (rule 6)", () => {
  it("destructures a default and named bindings from the awaited __import", () => {
    const { code, analysis } = run('import d, { a as b, c } from "p"');
    expect(code).toContain(
      '({ default: __scope.d, a: __scope.b, c: __scope.c } = await __scope.__import("p"));',
    );
    expect(analysis.defines).toEqual(["d", "b", "c"]);
    expect(analysis.kinds).toEqual({ d: "import", b: "import", c: "import" });
    expect(analysis.imports).toEqual(["p"]);
  });

  it("assigns a namespace import and reads a default beside it from the namespace", () => {
    const { code } = run('import * as ns from "p"\nimport d, * as ns2 from "q"');
    expect(code).toContain('__scope.ns = await __scope.__import("p");');
    expect(code).toContain(
      '__scope.ns2 = await __scope.__import("q");\n    __scope.d = __scope.ns2.default;',
    );
  });

  it("awaits a side-effect import and an import whose bindings are all types", () => {
    const { code, analysis } = run('import "p"\nimport { type T } from "q"');
    expect(code).toContain('await __scope.__import("p");\n    await __scope.__import("q");');
    expect(analysis.defines).toEqual([]);
  });

  it("drops type-only imports and type specifiers, and import attributes", () => {
    const { code, analysis } = run(
      'import type { T } from "t"\nimport { a, type B } from "p" with { type: "json" }',
    );
    expect(body(code)).not.toContain('"t"');
    expect(code).toContain('({ a: __scope.a } = await __scope.__import("p"));');
    expect(body(code)).not.toContain("json");
    expect(analysis.imports).toEqual(["p"]);
  });

  it("keeps a string-named import binding as a string key", () => {
    expect(run('import { "a-b" as ab } from "p"').code).toContain(
      '({ "a-b": __scope.ab } = await __scope.__import("p"));',
    );
  });
});

describe("dynamic import (rule 7)", () => {
  it("records dynamic import specifiers in source order, deduplicated, literals only", () => {
    const { analysis } = run('import "a"\nimport("b")\nimport("a")\nimport(name)');
    expect(analysis.imports).toEqual(["a", "b"]);
  });
});

describe("exports (rule 8)", () => {
  it("exports declared names after their assignment", () => {
    const { code, analysis } = run("export const x = 1\nexport let y = 2\nexport class C {}");
    expect(code).toContain(
      '__scope.x = 1;\n    __scope.__export("x");\n    __scope.y = 2;\n    __scope.__export("y");',
    );
    expect(code).toContain('__scope.C = class C {\n    };\n    __scope.__export("C");');
    expect(analysis.exports).toEqual(["x", "y", "C"]);
  });

  it("exports an export list with the exported name first and the local name when different", () => {
    const { code, analysis } = run("const a = 1, b = 2\nexport { a, b as c }");
    expect(code).toContain('__scope.__export("a");\n    __scope.__export("c", "b");');
    expect(analysis.exports).toEqual(["a", "c"]);
  });

  it("exports every name of a destructured declaration", () => {
    const { code, analysis } = run("export const { a, b: [c] } = o\nexport const [x] = arr");
    expect(code).toContain('__scope.__export("a");\n    __scope.__export("c");');
    expect(code).toContain('__scope.__export("x");');
    expect(analysis.exports).toEqual(["a", "c", "x"]);
  });

  it("drops export type and type specifiers", () => {
    const { code, analysis } = run("const a = 1\nexport type { T }\nexport { type U, a }");
    expect(body(code)).not.toMatch(/\b[TU]\b/);
    expect(code).toContain('__scope.__export("a");');
    expect(analysis.exports).toEqual(["a"]);
  });

  it("keeps exports in source order and deduplicated in the analysis, hoisted functions included", () => {
    const { analysis } = run("export const a = 1\nexport function f() {}\nexport { a, f as g }");
    expect(analysis.exports).toEqual(["a", "f", "g"]);
  });
});
