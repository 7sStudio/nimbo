// One cell's CodeMirror: the extensions CellEditor creates its view with. The language follows
// the cell's type (grammars.ts, loaded on first use), wrapping follows
// editor.wordWrap, and the syntax-error underline follows the cell's last run; each sits in a compartment so a change
// reconfigures the one view (a Vue re-render never recreates it, so the caret survives an agent's edit).
import { autocompletion, closeCompletion, completionStatus } from "@codemirror/autocomplete";
import {
  bracketMatching,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, search } from "@codemirror/search";
import type { Extension, TransactionSpec } from "@codemirror/state";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from "@codemirror/view";

import type { Word } from "./completion.js";
import { wordCompletion } from "./completion.js";
import { completionIcon } from "./completionIcons.js";
import type { grammars as Grammars } from "./grammars.js";
import type { Leave } from "./keymap.js";
import { editorKeys } from "./keymap.js";
import { bracketsAndGuides } from "./brackets.js";
import { findRow } from "./findRow.js";
import type { NamedValue } from "./lineValues.js";
import { lineValues } from "./lineValues.js";
import type { AgentLines } from "./marks.js";
import { agentOf, failedLineOf, hangingIndent, textSelection } from "./marks.js";

export type { AgentLines } from "./marks.js";
import { editorHighlight, editorTheme } from "./theme.js";

export type EditorLanguage = "code" | "markdown";

export type EditorOptions = {
  readonly language: EditorLanguage;
  readonly wordWrap: boolean;
  /** The text's accessible name ("Cell 3 source"). */
  readonly label: string;
  /** The text cannot change here (a view-only tab, a page that cannot write). */
  readonly readOnly: boolean;
  readonly tabSize: number;
  /** The line the last run failed at, its number marked in the gutter; null or absent for none. */
  readonly failedLine?: number | null;
  /** The lines an agent changed that no one reviewed yet, and the words of its edit (none when absent). */
  readonly agentLines?: AgentLines | null;
  /** The values the lines may show at first, by name (lineValues.ts); none when absent. */
  readonly lineValues?: ReadonlyMap<string, NamedValue>;
  /** A value at a line's end was clicked. */
  readonly onValue?: (name: string) => void;
  /** Words to complete (the notebook's identifiers and import names). */
  readonly words: () => readonly Word[];
  readonly onChange: (text: string) => void;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
  readonly onLeave: (edge: Leave) => void;
  /** Where the caret is, 1-based, whenever it moves or the editor takes the focus (the status bar's line and column). */
  readonly onCaret?: (line: number, column: number) => void;
};

/** The parts a later change reconfigures. */
export type Compartments = {
  readonly language: Compartment;
  readonly wrap: Compartment;
  readonly label: Compartment;
  readonly readOnly: Compartment;
  readonly tab: Compartment;
  readonly failed: Compartment;
  readonly agent: Compartment;
  /** The language service's extensions (editor/language/host.ts): none until its chunk is loaded. */
  readonly lsp: Compartment;
  /** The breakpoint gutter (debugGutter.ts): none until its chunk is loaded, never in a markdown cell. */
  readonly debug: Compartment;
};

let grammars: Promise<typeof Grammars> | undefined;

/** The grammar of `language`, from its chunk (loaded once, 08-code-standards §10: the page's first load stays small). */
export async function grammarOf(language: EditorLanguage): Promise<Extension> {
  grammars ??= import("./grammars.js").then((module) => module.grammars);
  return (await grammars)[language];
}

const readOnlyOf = (readOnly: boolean): Extension => EditorState.readOnly.of(readOnly);

const tabOf = (size: number): Extension => [
  EditorState.tabSize.of(size),
  indentUnit.of(" ".repeat(Math.max(1, size))),
];

/** Wrapping, and a wrapped line's continuation hanging under its own text (marks.ts). */
const wrapOf = (wrap: boolean): Extension => (wrap ? [EditorView.lineWrapping, hangingIndent] : []);

const labelOf = (label: string): Extension =>
  EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" });

/** The main caret's line and column, 1-based. */
function caretOf(state: EditorState): { readonly line: number; readonly column: number } {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return { line: line.number, column: head - line.from + 1 };
}

function listeners(options: EditorOptions): Extension {
  return [
    EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.focusChanged || update.docChanged) {
        const { line, column } = caretOf(update.state);
        if (update.view.hasFocus) options.onCaret?.(line, column);
      }
      // the store's own text (an agent's edit, replaceWith below) is not the user's: it is never sent back
      const typed = update.transactions.some(
        (tr) => tr.docChanged && tr.annotation(Transaction.remote) !== true,
      );
      if (typed) options.onChange(update.state.doc.toString());
      // a completion answered after the editor lost focus (the language service's, once a run left edit mode) would
      // open on a cell nobody types in, over the page; CodeMirror closes only the ones open at the blur
      if (completionStatus(update.state) !== null && !update.view.hasFocus) {
        const { view } = update;
        queueMicrotask(() => closeCompletion(view));
      }
    }),
    // the DOM's own focus and blur, at once: CodeMirror reports a focus change a few milliseconds later, and a click
    // into the editor followed by Esc within them would enter edit mode after it was left
    EditorView.domEventHandlers({
      focus: () => {
        options.onFocus();
      },
      blur: () => {
        options.onBlur();
      },
    }),
  ];
}

/** Every extension of a cell's view: the keys, the gutter, the selection and the editor's marks, completion and find,
 * the theme, each compartment at its first value, and the listeners. */
function extensionsOf(options: EditorOptions, parts: Compartments): Extension[] {
  return [
    editorKeys(options.onLeave),
    parts.debug.of([]),
    lineNumbers(),
    drawSelection(),
    textSelection,
    highlightActiveLine(),
    highlightActiveLineGutter(),
    indentOnInput(),
    bracketMatching(),
    bracketsAndGuides,
    highlightSelectionMatches(),
    search({ createPanel: findRow, top: true }),
    autocompletion({
      override: [wordCompletion(options.words)],
      icons: false,
      // VS Code's kind icons at each row's start (completionIcons.ts)
      addToOptions: [{ render: completionIcon, position: 20 }],
      tooltipClass: () => "cm-nimboComplete",
    }),
    lineValues(options.lineValues ?? new Map(), options.onValue),
    syntaxHighlighting(editorHighlight),
    editorTheme,
    parts.language.of([]),
    parts.wrap.of(wrapOf(options.wordWrap)),
    parts.label.of(labelOf(options.label)),
    parts.readOnly.of(readOnlyOf(options.readOnly)),
    parts.tab.of(tabOf(options.tabSize)),
    parts.failed.of(failedLineOf(options.failedLine ?? null)),
    parts.agent.of(agentOf(options.agentLines)),
    parts.lsp.of([]),
    listeners(options),
  ];
}

/** The state a cell's view starts with, and the compartments that change it later. */
export function editorState(
  doc: string,
  options: EditorOptions,
): { readonly state: EditorState; readonly parts: Compartments } {
  const parts = {
    language: new Compartment(),
    wrap: new Compartment(),
    label: new Compartment(),
    readOnly: new Compartment(),
    tab: new Compartment(),
    failed: new Compartment(),
    agent: new Compartment(),
    lsp: new Compartment(),
    debug: new Compartment(),
  };
  const state = EditorState.create({ doc, extensions: extensionsOf(options, parts) });
  return { state, parts };
}

export const reconfigure = {
  /** The grammar once grammarOf has it. */
  language: (parts: Compartments, grammar: Extension): TransactionSpec => ({
    effects: parts.language.reconfigure(grammar),
  }),
  wrap: (parts: Compartments, wrap: boolean): TransactionSpec => ({
    effects: parts.wrap.reconfigure(wrapOf(wrap)),
  }),
  label: (parts: Compartments, label: string): TransactionSpec => ({
    effects: parts.label.reconfigure(labelOf(label)),
  }),
  readOnly: (parts: Compartments, readOnly: boolean): TransactionSpec => ({
    effects: parts.readOnly.reconfigure(readOnlyOf(readOnly)),
  }),
  tab: (parts: Compartments, size: number): TransactionSpec => ({
    effects: parts.tab.reconfigure(tabOf(size)),
  }),
  /** The gutter's mark on the line the last run failed at (none: null). */
  failed: (parts: Compartments, line: number | null): TransactionSpec => ({
    effects: parts.failed.reconfigure(failedLineOf(line)),
  }),
  /** The violet numbers of the lines an agent changed (none: null). */
  agent: (parts: Compartments, agent: AgentLines | null): TransactionSpec => ({
    effects: parts.agent.reconfigure(agentOf(agent)),
  }),
};

/** The change that makes the document `text` with the fewest characters replaced, so a caret outside the change
 * stays where it was (an agent's edit to the cell being edited), marked as the store's. */
export function replaceWith(state: EditorState, text: string): TransactionSpec | null {
  const old = state.doc.toString();
  if (old === text) return null;
  let start = 0;
  while (start < old.length && start < text.length && old[start] === text[start]) start += 1;
  let end = 0;
  while (
    end < old.length - start &&
    end < text.length - start &&
    old[old.length - 1 - end] === text[text.length - 1 - end]
  )
    end += 1;
  return {
    changes: { from: start, to: old.length - end, insert: text.slice(start, text.length - end) },
    // the store's text: not the user's typing (never sent back) and not a step of the editor's undo
    annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
  };
}
