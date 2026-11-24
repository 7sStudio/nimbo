// The language service's page-side types, apart from host.ts and the chunk, so the chunk
// never imports the module that loads it.
import type { CompletionSource } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { CellPosition } from "@jsnb/core";

export type LanguageHost = {
  readonly notebook: () => string;
  /** language.lsp: one LSP message out, the reply text in (null for a notification). */
  readonly lsp: (message: string) => Promise<string | null>;
  /** editor.intellisense. */
  readonly intellisense: () => boolean;
  /** Selects the cell, unfolds it, enters its editor; resolves with its view once it is mounted. */
  readonly openCell: (cell: string) => Promise<EditorView | null>;
  /** A definition outside the cells: says which file and line. */
  readonly showFile: (path: string, line: number) => void;
  /** language.rename after the drafts are sent; resolves with the refusal's reason, or null when it was done. */
  readonly rename: (cell: string, at: CellPosition, newName: string) => Promise<string | null>;
  /** Renames are off (a view-only tab, a page that cannot write). */
  readonly readOnly: () => boolean;
  /** A hint's expand button: the whole hint in a dialog (`html` is the popup's own, already sanitized). */
  readonly expand: (title: string, html: string) => void;
};

/** The lazy chunk (client.ts) as host.ts uses it; `host` reads the page's side as it is at each call. */
export type LanguageChunk = {
  readonly cellExtensions: (host: () => LanguageHost, cell: string) => Extension;
  readonly completionSource: CompletionSource;
  readonly reconnect: (host: LanguageHost) => void;
};
