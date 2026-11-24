// analyze(): the analysis without an emit, equal to transform's and throwing the same errors.
import { beforeAll, describe, expect, it } from "vitest";

import { InvalidSyntax, ReservedName } from "@jsnb/core";

import { analyze, transform } from "./index.js";

const filename = "jsnb:///rules.jsnb/c_7.ts";
const cell =
  'import d from "p"\nexport const { a, b: [c] } = o\nfunction f() { return count += 1 }\nclass K {}\ntypeof y\nf(d)';

beforeAll(() => {
  transform(cell, { filename });
});

describe("analyze", () => {
  it("returns the frozen analysis transform would report", () => {
    const analysis = analyze(cell);
    expect(analysis).toEqual(transform(cell, { filename }).analysis);
    expect(analysis).toEqual({
      defines: ["d", "a", "c", "f", "K"],
      uses: ["o", "count", "y"],
      exports: ["a", "c"],
      imports: ["p"],
      kinds: { d: "import", a: "const", c: "const", f: "function", K: "class" },
    });
    expect(Object.isFrozen(analysis)).toBe(true);
  });

  it("returns an empty analysis for an empty cell", () => {
    expect(analyze("")).toEqual({ defines: [], uses: [], exports: [], imports: [], kinds: {} });
  });

  it("throws the same errors as transform", () => {
    expect(() => analyze("const x = ;")).toThrow(InvalidSyntax);
    expect(() => analyze("let __scope")).toThrow(ReservedName);
  });
});
