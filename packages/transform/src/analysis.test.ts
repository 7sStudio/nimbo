// The analysis semantics: defines, uses, exports, imports and kinds.
import { beforeAll, describe, expect, it } from "vitest";

import type { CellAnalysis } from "@jsnb/core";

import { analyze, transform } from "./index.js";

const filename = "jsnb:///rules.jsnb/c_5.ts";
/** A representative cell, so the first test does not pay the compiler's warm-up. */
const warmCell =
  'import d, { a } from "p"\nconst { x, y: [z] } = o\nfunction f(n) { return n + a }\nclass C extends B { m() { return x } }\nexport { z }\nf(d)';

/** The analysis of `transform`, checked against `analyze` on every input (one classifier). */
const analysisOf = (source: string): CellAnalysis => {
  const { analysis } = transform(source, { filename });
  expect(analyze(source)).toEqual(analysis);
  return analysis;
};

beforeAll(() => {
  transform(warmCell, { filename });
});

describe("analysis.defines", () => {
  it("lists every top-level declaration in source order of first appearance", () => {
    expect(
      analysisOf("const r = h()\nfunction h() {}\nclass C {}\nlet { a, b: [c] } = o\nvar v")
        .defines,
    ).toEqual(["r", "h", "C", "a", "c", "v"]);
  });

  it("includes imports and var hoisted from blocks and loops", () => {
    expect(
      analysisOf(
        'import d, * as ns from "p"\n{ var inner = 1 }\nfor (var i = 0;;) {}\nfor (var k in o) {}',
      ).defines,
    ).toEqual(["d", "ns", "inner", "i", "k"]);
  });

  it("includes top-level writes to free names, with and without a read", () => {
    const analysis = analysisOf("x = 3\ncount += 1;\n[y] = e\nn++");
    expect(analysis.defines).toEqual(["x", "count", "y", "n"]);
    expect(analysis.kinds).toEqual({});
  });

  it("leaves a write inside a nested function out", () => {
    expect(analysisOf("function f() { x = 3; y++ }").defines).toEqual(["f"]);
  });

  it("deduplicates a name declared and written", () => {
    expect(analysisOf("let x\nx = 3\nx = 4").defines).toEqual(["x"]);
  });
});

describe("analysis.uses", () => {
  it("lists free names read at any depth, typeof included, deduplicated", () => {
    expect(analysisOf("a + a\nfunction f() { return b.c + (() => typeof d)() }").uses).toEqual([
      "a",
      "b",
      "d",
    ]);
  });

  it("includes realm globals such as fetch and Error on purpose", () => {
    expect(analysisOf('await fetch(u)\nnew Error("x")').uses).toEqual(["fetch", "u", "Error"]);
  });

  it("puts a name written and read at top level in both uses and defines", () => {
    const analysis = analysisOf("count += 1");
    expect(analysis.uses).toEqual(["count"]);
    expect(analysis.defines).toEqual(["count"]);
  });

  it("excludes names declared in the cell, pure writes and locals", () => {
    expect(
      analysisOf("let x; x = 3\nconst y = 1\ny\nfunction f(p) { let l = p; return l }\nz = 1").uses,
    ).toEqual([]);
  });

  it("includes a free name read inside a nested function even when written there", () => {
    expect(analysisOf("function f() { n++ }").uses).toEqual(["n"]);
  });
});

describe("analysis.kinds", () => {
  it("records const, let, var, function, class and import by declaration", () => {
    const { kinds } = analysisOf(
      'const a = 1\nlet b\nvar c\nfunction f() {}\nclass K {}\nimport i from "p"\n{ var d }',
    );
    expect(kinds).toEqual({
      a: "const",
      b: "let",
      c: "var",
      f: "function",
      K: "class",
      i: "import",
      d: "var",
    });
  });

  it("is frozen together with the lists", () => {
    const analysis = analysisOf("const a = 1");
    expect(Object.isFrozen(analysis)).toBe(true);
    expect(Object.isFrozen(analysis.defines)).toBe(true);
    expect(Object.isFrozen(analysis.kinds)).toBe(true);
  });
});
