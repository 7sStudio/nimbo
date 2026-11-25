// A cell compiled the way the kernel compiles one, for the stack tests of outputs/: the real transform through
// tools/test's compileCell, then the kernel's own compiler (vm.runInThisContext under the cell's exact URL, the real
// source map), and a run of it over a real scope. Its positions context is the compiler's, as the realm passes it.
import type { CompiledCell } from "@jsnb/test-tools/kernel";
import { compileCell } from "@jsnb/test-tools/kernel";

import { createCompiler } from "../compile.js";
import type { FrameContext } from "../outputs/frames.js";
import { createScope } from "../scope/record.js";

export type RealCell = {
  /** The exact URL the cell's code runs under (core's cellUrl of its notebook ref). */
  readonly url: string;
  readonly cell: string;
  /** The compiler's positions context, with `internal` as the kernel's own directories. */
  readonly context: FrameContext;
  /** Runs the cell over a fresh scope; resolves with its value or with what it threw. */
  readonly run: () => Promise<unknown>;
};

type Options = {
  readonly cell?: string;
  readonly notebook?: string;
  readonly internal?: readonly string[];
};

/** `source` compiled as a cell of `notebook` (default `test.jsnb`) by the kernel's own compiler. */
export function realCell(source: string, options: Options = {}): RealCell {
  const cell = options.cell ?? "c_abc123";
  const compiled: CompiledCell = compileCell(source, {
    cell,
    execution: "x_00000001",
    notebook: options.notebook ?? "test.jsnb",
  });
  const compiler = createCompiler();
  const result = compiler.compile(cell, compiled.code, compiled.map);
  if (!result.ok) throw new Error(`the cell did not compile: ${String(result.error)}`);
  const context: FrameContext = {
    cellOf: compiler.cellOf,
    cellUrls: compiler.cellUrls,
    mapFor: compiler.mapFor,
    internal: options.internal ?? [],
  };
  const plumbing = {
    __import: (specifier: string) => import(specifier),
    __export: () => undefined,
  };
  const run = (): Promise<unknown> => {
    const { record } = createScope({ builtins: {}, plumbing, onCreate: () => undefined });
    return result.fn(record).catch((error: unknown) => error);
  };
  return { url: compiler.cellUrls()[0] ?? "", cell, context, run };
}
