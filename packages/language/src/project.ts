// One notebook's language project: its cells' virtual files and two TypeScript
// language services, one per realm, over one document registry. Pure and synchronous.
import type { CellDiagnostics, CellId, CellPosition } from "@jsnb/core";

import { cellDiagnostics } from "./diagnostics.js";
import type { At } from "./lookup.js";
import type { EnvNames, NotebookFiles } from "./notebookFiles.js";
import { createNotebookFiles } from "./notebookFiles.js";
import * as queries from "./queries.js";
import { rename } from "./rename.js";
import type {
  CompletionEntry,
  DefinitionTarget,
  Details,
  Hover,
  LanguageCell,
  RenameResult,
  SignatureHelp,
} from "./types.js";
import type { VirtualCell } from "./virtual.js";
import { offsetOf } from "./virtual.js";
import { otherRealmNames } from "./visibility.js";

export type { EnvNames } from "./notebookFiles.js";

export type LanguageProjectOptions = {
  /** The workspace folder, as a real path. */
  readonly root: string;
  /** The notebook ref, for the file names. */
  readonly notebook: string;
  /** Where the daemon's own `@types` live (the folder holding `node`), after the workspace's. */
  readonly fallbackTypeRoots: readonly string[];
};

export type LanguageProject = {
  /** The notebook's code cells in document order, and the env names; replaces what was there. */
  readonly sync: (cells: readonly LanguageCell[], env?: EnvNames) => void;
  /** Every code cell's diagnostics in document order, or one cell's. */
  readonly diagnostics: (cell?: CellId) => readonly CellDiagnostics[];
  readonly completions: (cell: CellId, at: CellPosition) => readonly CompletionEntry[];
  readonly completionDetails: (cell: CellId, at: CellPosition, label: string) => Details | null;
  readonly hover: (cell: CellId, at: CellPosition) => Hover | null;
  readonly signature: (cell: CellId, at: CellPosition) => SignatureHelp | null;
  readonly definition: (cell: CellId, at: CellPosition) => readonly DefinitionTarget[];
  readonly rename: (cell: CellId, at: CellPosition, to: string) => RenameResult;
  readonly dispose: () => void;
};

/** One cell's diagnostics, filtered with what the other cells declare. */
function diagnosticsOf(files: NotebookFiles, cell: VirtualCell, index: number): CellDiagnostics {
  const scanned = files.scanned();
  const service = files.service(cell.realm);
  const sameRealm = scanned
    .filter((other, i) => i !== index && other.realm === cell.realm)
    .flatMap((other) => [...other.declarations.names.keys()]);
  const context = {
    cell,
    own: new Set(scanned[index]?.declarations.names.keys()),
    sameRealm: new Set(sameRealm),
    otherRealm: otherRealmNames(scanned, cell.realm),
  };
  const syntactic = service.getSyntacticDiagnostics(cell.fileName);
  const semantic = service.getSemanticDiagnostics(cell.fileName);
  return { cell: cell.id, diagnostics: cellDiagnostics(context, syntactic, semantic) };
}

export function createLanguageProject(options: LanguageProjectOptions): LanguageProject {
  const files = createNotebookFiles(options);
  /** Runs `query` at a position of a cell, or answers `none` for a cell the project has no file for. */
  const at =
    <A extends unknown[], R>(query: (where: At, ...args: A) => R, none: R) =>
    (id: CellId, position: CellPosition, ...args: A): R => {
      const cell = files.cell(id);
      if (!cell) return none;
      return query({ cell, offset: cell.start + offsetOf(cell, position) }, ...args);
    };
  return {
    sync: files.sync,
    diagnostics: (id) =>
      files
        .cells()
        .flatMap((cell, index) =>
          id === undefined || cell.id === id ? [diagnosticsOf(files, cell, index)] : [],
        ),
    completions: at((where) => queries.completions(files, where), []),
    completionDetails: at(
      (where, label: string) => queries.completionDetails(files, where, label),
      null,
    ),
    hover: at((where) => queries.hover(files, where), null),
    signature: at((where) => queries.signature(files, where), null),
    definition: at((where) => queries.definition(files, where), []),
    rename: at((where, to: string) => rename(files, where, to), {
      refused: "This cell has no code.",
    }),
    dispose: files.dispose,
  };
}
