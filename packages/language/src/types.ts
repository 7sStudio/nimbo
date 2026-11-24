// The package's result types: plain shapes the daemon turns into LSP's (§5.3).
import type { CellId, CellRange } from "@jsnb/core";

export type LanguageCell = {
  readonly id: CellId;
  readonly type: "server" | "client";
  readonly source: string;
};

/** `kind` is TypeScript's ScriptElementKind (`method`, `property`, `const`, …). */
export type CompletionEntry = {
  readonly label: string;
  readonly kind: string;
  readonly sortText: string;
  /** Text to insert instead of the label: `?.amount` or `["a-b"]` replaces the `.` before the word too. */
  readonly insertText?: string;
  /** The entry's type, on a list of at most `detailedListMax` entries. */
  readonly detail?: string;
  /** Its documentation as markdown, on the same lists. */
  readonly documentation?: string;
};

/** A symbol's signature line and its documentation as markdown text (JSDoc tags included). */
export type Details = { readonly signature: string; readonly documentation: string };

export type Hover = Details & { readonly range: CellRange };

export type SignatureHelp = {
  readonly signatures: readonly {
    readonly label: string;
    readonly parameters: readonly { readonly label: string; readonly documentation: string }[];
    readonly documentation: string;
  }[];
  readonly active: number;
  readonly activeParameter: number;
};

/** A place in a cell, or in a file outside the cells (an absolute path; the range's lines in that file). */
export type DefinitionTarget =
  | { readonly cell: CellId; readonly range: CellRange }
  | { readonly file: string; readonly range: CellRange };

export type RenameResult =
  | { readonly edits: readonly { readonly cell: CellId; readonly source: string }[] }
  | { readonly refused: string };
