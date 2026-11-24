// The TypeScript Program of one cell: the compiler options of 04 §3.2 and a host that serves that single file.
import ts from "typescript";

import { InvalidSyntax } from "@jsnb/core";

export type CellProgram = {
  readonly program: ts.Program;
  readonly file: ts.SourceFile;
  /** What `program.emit` wrote, by output path (`/out/<name>.js`, `/out/<name>.js.map`). */
  readonly outputs: ReadonlyMap<string, string>;
};

/** The options of 04 §3.2; `noEmitHelpers` because `helpers.ts` places the helpers inside the wrapper itself. */
export const compilerOptions: ts.CompilerOptions = {
  noLib: true,
  noResolve: true,
  types: [],
  target: ts.ScriptTarget.ES2024,
  module: ts.ModuleKind.ESNext,
  moduleDetection: ts.ModuleDetectionKind.Force,
  sourceMap: true,
  inlineSources: true,
  newLine: ts.NewLineKind.LineFeed,
  // A trailing `// comment` would be printed inside `return (expr)`; the map's sourcesContent keeps every comment.
  removeComments: true,
  noEmitHelpers: true,
  outDir: "/out",
};

/** The syntax check of 04 §4 step 1: the first syntactic diagnostic is an `InvalidSyntax`; nothing semantic is read. */
export function checkSyntax(program: ts.Program, file: ts.SourceFile): void {
  const [first] = program.getSyntacticDiagnostics(file);
  if (!first) return;
  const { line, character } = file.getLineAndCharacterOfPosition(first.start);
  const detail = ts.flattenDiagnosticMessageText(first.messageText, "\n");
  throw new InvalidSyntax({ line: line + 1, col: character + 1, detail });
}

/**
 * Parses `source` as the TypeScript file `/<name>` of a Program that knows nothing else (`noLib`, `noResolve`),
 * so the binder classifies every identifier and the checker has no library to consult.
 */
export function createCellProgram(source: string, name: string): CellProgram {
  const fileName = `/${name}`;
  const outputs = new Map<string, string>();
  let file: ts.SourceFile | undefined;
  const host: ts.CompilerHost = {
    // The Program passes the options derived from `moduleDetection: Force`, so top-level `await` parses as a module.
    getSourceFile: (requested, languageVersionOrOptions) => {
      if (requested !== fileName) return undefined;
      file ??= ts.createSourceFile(
        fileName,
        source,
        languageVersionOrOptions,
        true,
        ts.ScriptKind.TS,
      );
      return file;
    },
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: (path, text) => {
      outputs.set(path, text);
    },
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (path) => path,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (path) => path === fileName,
    readFile: () => undefined,
    directoryExists: () => true,
    getDirectories: () => [],
  };
  const program = ts.createProgram({ rootNames: [fileName], options: compilerOptions, host });
  const parsed = program.getSourceFile(fileName);
  if (!parsed) throw new Error(`the Program did not load ${fileName}`);
  return { program, file: parsed, outputs };
}
