// What a card needs beyond its CellModel: the page's settings and services, the same for every card,
// and the cell's own outputs, values and editor state. CellList builds both from the stores (cells/useCells.ts).
import type { BindingValue, CellMeta, Diagnostic, ErrorInfo, Output, Route } from "@jsnb/core";

import type { Word } from "../editor/completion.js";
import type { Caret } from "../store/ui.js";
import type { OutputHost } from "./outputHost.js";

/** output-view's load-more request and its answer (cell.outputValue), as the
 * viewer's LoadMoreRequest and ValueSlice are shaped; ui's .ts files take no type from output-view, whose declarations
 * are built after ui's build-order project. */
type LoadMoreRequest = { readonly path: string; readonly offset: number; readonly limit: number };
type ValueSlice = { readonly json: unknown; readonly total: number; readonly truncated: boolean };

/** A change to a cell's own meta: a key set to null is removed (cell.update). */
export type MetaPatch = {
  readonly [
    K in
      | "title"
      | "showBindings"
      | "collapsed"
      | "outputsHidden"
      | "outputView"
      | "outputQuery"
      | "outputHeight"
      | "outputColumns"
  ]?: CellMeta[K] | null;
};

/** A page request to the first value output: find (⌘F), the query bar (⌘⇧F) or full screen (⌘⇧O). */
export type OutputKeys = { readonly kind: "find" | "query" | "fullscreen"; readonly at: number };

export type CardPage = {
  /** ⌘ and ⌥ on macOS, Ctrl and Alt elsewhere. */
  readonly mac: boolean;
  readonly host: OutputHost;
  /** The height cap of a result in px: seven lines (cells/resultLines.ts), or outputs.maxHeightPx when the user or the
   * workspace set it. */
  readonly maxHeight: number;
  /** The cap is the page's seven lines. */
  readonly sevenLines: boolean;
  /** editor.wordWrap and editor.tabSize. */
  readonly wordWrap: boolean;
  readonly tabSize: number;
  /** The notebook's import names and words, for completions (editor/completion.ts). */
  readonly words: () => readonly Word[];
  /** Writes are off on this page: the editor is read-only and the toolbar's actions are off. */
  readonly off: boolean;
  readonly loadMore: (
    cell: string,
    index: number,
    request: LoadMoreRequest,
    signal: AbortSignal,
  ) => Promise<ValueSlice>;
  /** "this cell" or "cell 2" from the card of `cell`. */
  readonly definedBy: (cell: string, by: string) => string;
  /** The cell of `cell`'s realm that defines the function `name` shows in its output ("view source
   * in cell 3"), the last one in order when several do; undefined when none does. A heuristic on the name alone: a
   * built-in or imported function that shares a cell's name links to that cell. */
  readonly functionSource: (
    cell: string,
    name: string,
  ) => { readonly cell: string; readonly label: string } | undefined;
};

export type CardState = {
  readonly outputs: readonly Output[];
  /** The error its last run ended with (its error block under the outputs), a cell's id in its data said as "cell 2";
   * null when it did not throw. An error a callback raised (a handler's, a timer's), during or after the run, is one of the outputs. */
  readonly error: ErrorInfo | null;
  /** The routes it registered that are listening: its result shows their requests. */
  readonly routes: readonly Route[];
  readonly execution: string | null;
  readonly request: OutputKeys | null;
  readonly live: {
    readonly slotInto: (into: HTMLElement) => boolean;
    /** Back to the park from `from`, unless another slot took it meanwhile. */
    readonly release: (from: HTMLElement) => void;
  } | null;
  /** The values view: undefined when closed, null while its answer is on its way. */
  readonly values: readonly BindingValue[] | null | undefined;
  readonly caret: Caret;
  /** Text typed in the editor that the store does not have yet. */
  readonly draft: string | undefined;
  /** The language service's diagnostics for the cell; null while it gave none. */
  readonly diagnostics: readonly Diagnostic[] | null;
  /** The packages its last run found missing (MissingPackage): the card offers to install them. */
  readonly missing: readonly string[];
  /** The client cell its last run needed (DefinedInClient): the card offers to switch it to client. */
  readonly inClient: { readonly name: string; readonly index: number } | null;
  /** The cell's menu open now, if any: its opener's aria-expanded. */
  readonly menu: "cell" | "type" | null;
};
