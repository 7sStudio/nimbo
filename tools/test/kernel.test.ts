// Tests compileCell (the transform's request for a cell) and kernelEntry (the kernel child from source).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import type { CompiledCell } from "./kernel.js";
import { compileCell, kernelEntry } from "./kernel.js";

let first: CompiledCell;
let other: CompiledCell;

beforeAll(() => {
  first = compileCell("export const answer: number = 42\nlet note;", {
    cell: "c_aaaaaa",
    execution: "x_aaaaaaaa",
  });
  other = compileCell("answer + 1", {
    cell: "c_bbbbbb",
    execution: "x_bbbbbbbb",
    notebook: "sub/demo.jsnb",
  });
});

describe("compileCell", () => {
  it("returns the wrapped code, the ids and the analysis of the cell", () => {
    expect(first.code.startsWith("(async (__scope) => {")).toBe(true);
    expect(first.execution).toBe("x_aaaaaaaa");
    expect(first.cell).toBe("c_aaaaaa");
    expect(first.defines).toEqual(["answer", "note"]);
    expect(first.kinds).toEqual({ answer: "const", note: "let" });
  });

  it("names the cell jsnb:///test.jsnb/<cell>.ts by default and another notebook when asked", () => {
    expect(JSON.parse(first.map)).toMatchObject({ file: "jsnb:///test.jsnb/c_aaaaaa.ts" });
    expect(other.code).toContain("//# sourceURL=jsnb:///sub/demo.jsnb/c_bbbbbb.ts");
    expect(other.defines).toEqual([]);
  });

  it("builds the URL with core's cellUrl, so a ref with spaces gives a URL without any", () => {
    const spaced = compileCell("1", {
      cell: "c_cccccc",
      execution: "x_cccccccc",
      notebook: "My Notes/a (1).jsnb",
    });
    expect(spaced.code).toContain("//# sourceURL=jsnb:///My%20Notes/a%20%281%29.jsnb/c_cccccc.ts");
  });
});

describe("kernelEntry", () => {
  it("points at the kernel's main.ts and imports the resolve hook under the development condition", () => {
    expect(kernelEntry.path.endsWith("packages/kernel-node/src/main.ts")).toBe(true);
    expect(kernelEntry.execArgv.slice(0, 2)).toEqual(["--conditions=development", "--import"]);
    expect(existsSync(fileURLToPath(kernelEntry.execArgv[2]))).toBe(true);
  });
});
