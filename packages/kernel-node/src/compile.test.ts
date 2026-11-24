// Tests the compile step: once per cell and code, the cell URL as the script name, the source map kept for frames.
import type { CompiledCell } from "@jsnb/test-tools/kernel";
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import type { CellFunction, Compiler } from "./compile.js";
import { createCompiler } from "./compile.js";

let first: CompiledCell;
let second: CompiledCell;

beforeAll(() => {
  first = compileCell("const a = 1\nthrow new Error('x')", {
    cell: "c_aaaaaa",
    execution: "x_aaaaaaaa",
  });
  second = compileCell("2", { cell: "c_aaaaaa", execution: "x_bbbbbbbb" });
});

describe("createCompiler", () => {
  it("compiles a cell once per code and again when its code changes", () => {
    const compiler: Compiler = createCompiler();
    const one = compiler.compile(first.cell, first.code, first.map);
    const same = compiler.compile(first.cell, first.code, first.map);
    const changed = compiler.compile(second.cell, second.code, second.map);
    expect(one.ok && same.ok && one.fn === same.fn).toBe(true);
    expect(changed.ok && one.ok && changed.fn !== one.fn).toBe(true);
  });

  it("names the script after the cell URL and keeps the cell's source map", async () => {
    const compiler = createCompiler();
    const compiled = compiler.compile(first.cell, first.code, first.map);
    if (!compiled.ok) throw new Error("did not compile");
    const fn: CellFunction = compiled.fn;
    const error: unknown = await fn({}).catch((thrown: unknown) => thrown);
    expect(String((error as Error).stack)).toContain("jsnb:///test.jsnb/c_aaaaaa.ts:");
    expect(compiler.mapFor("c_aaaaaa")?.findOrigin(1, 1)).toBeDefined();
    expect(compiler.mapFor("c_zzzzzz")).toBeUndefined();
  });

  it("returns a failure for code V8 refuses, a map that is not one, and code that is no cell function", () => {
    const compiler = createCompiler();
    expect(compiler.compile("c_aaaaaa", "(((", first.map).ok).toBe(false);
    expect(compiler.compile("c_aaaaaa", first.code, "not json").ok).toBe(false);
    expect(compiler.compile("c_aaaaaa", "1 + 1", first.map)).toMatchObject({
      ok: false,
      error: { name: "CellCodeInvalid", data: { cell: "c_aaaaaa" } },
    });
  });
});
