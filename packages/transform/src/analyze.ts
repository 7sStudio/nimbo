// analyze(): the cell analysis alone: the same program, checks and rewrite rules as transform(), without an emit.
import type { CellAnalysis } from "@jsnb/core";
import ts from "typescript";

import { checkSyntax, compilerOptions, createCellProgram } from "./program.js";
import { createRewrite } from "./rewrite.js";
import { rewriteStatements } from "./statements.js";

/**
 * Parses, binds and classifies one cell and returns its frozen analysis; throws the same errors as `transform` for the
 * same source (`InvalidSyntax`, `DefaultExport`, `UnsupportedSyntax`, `ReservedName`). Nothing is printed or mapped.
 */
export function analyze(source: string): CellAnalysis {
  const { program, file } = createCellProgram(source, "cell.ts");
  checkSyntax(program, file);
  const checker = program.getTypeChecker();
  let analysis: CellAnalysis | undefined;
  const record: ts.TransformerFactory<ts.SourceFile> = (context) => (sourceFile) => {
    const rewrite = createRewrite(sourceFile, context, checker);
    rewriteStatements(rewrite);
    analysis = rewrite.recorder.freeze();
    return sourceFile;
  };
  ts.transform(file, [record], compilerOptions).dispose();
  if (!analysis) throw new Error("the rewrite did not run");
  return analysis;
}
