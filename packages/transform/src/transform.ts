// transform(): one cell → the Program, the syntax check, the emit with the rewrite, and the assembled result.
import type { CellAnalysis } from "@jsnb/core";
import type ts from "typescript";

import { moveHelpersInside } from "./helpers.js";
import { checkSyntax, createCellProgram } from "./program.js";
import { createRewrite } from "./rewrite.js";
import { assembleCell } from "./source-map.js";
import { rewriteStatements } from "./statements.js";

export type TransformOptions = {
  /** The cell's virtual URL, `jsnb:///<notebook>.jsnb/<cellId>.ts`: the sourceURL and the map's file; its `file:` form is the map's only source. */
  readonly filename: string;
};

export type TransformResult = {
  /** `(async (__scope) => { "use strict"; … });` followed by `//# sourceURL=<filename>` and the inline base64 map. */
  readonly code: string;
  /** The same v3 source map as JSON text: `file` is the filename, `sources[0]` its `file:` form, `sourcesContent[0]` the TypeScript source. */
  readonly map: string;
  readonly analysis: CellAnalysis;
};

function output(outputs: ReadonlyMap<string, string>, suffix: string): string {
  for (const [name, text] of outputs) if (name.endsWith(suffix)) return text;
  throw new Error(`the emitter produced no ${suffix} output`);
}

/**
 * Compiles one cell. A bad cell throws one of core's analysis errors (`InvalidSyntax`,
 * `DefaultExport`, `UnsupportedSyntax`, `ReservedName`), a `JsnbError`; never returns a partial result.
 */
export function transform(source: string, options: TransformOptions): TransformResult {
  const { filename } = options;
  const { program, file, outputs } = createCellProgram(
    source,
    filename.slice(filename.lastIndexOf("/") + 1),
  );
  checkSyntax(program, file);
  const checker = program.getTypeChecker();
  let analysis: CellAnalysis | undefined;
  const before: ts.TransformerFactory<ts.SourceFile> = (context) => (sourceFile) => {
    const rewrite = createRewrite(sourceFile, context, checker);
    const rewritten = rewriteStatements(rewrite);
    analysis = rewrite.recorder.freeze();
    return rewritten;
  };
  const transformers = { before: [before], after: [moveHelpersInside] };
  const emitted = program.emit(file, undefined, undefined, false, transformers);
  if (emitted.emitSkipped || !analysis) throw new Error("the emitter skipped the cell");
  const { code, map } = assembleCell(output(outputs, ".js"), output(outputs, ".js.map"), filename);
  return { code, map, analysis };
}
