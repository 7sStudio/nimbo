// The diff editors of the diff page: @codemirror/merge's side by side MergeView and inline
// unifiedMergeView, read-only, with the page's editor theme and syntax colours, word-level marks, unchanged runs folded
// behind a row that expands them (as GitHub and GitNotebooks fold a code diff), and the theme's own red and green.
import { goToNextChunk, goToPreviousChunk, MergeView, unifiedMergeView } from "@codemirror/merge";
import { syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";

import type { EditorLanguage } from "../editor/setup.js";
import { grammarOf } from "../editor/setup.js";
import { editorHighlight, editorTheme } from "../editor/theme.js";

/** The language of a file by its extension: the grammars the page ships, else plain text. */
export function languageOfPath(path: string): EditorLanguage | null {
  if (/\.(md|markdown)$/iu.test(path)) return "markdown";
  if (/\.(m?[jt]sx?|c[jt]s|json|vue)$/iu.test(path)) return "code";
  return null;
}

const band = (tone: "ok" | "err", strength: number) =>
  `color-mix(in oklch, var(--${tone}) ${String(strength)}%, transparent)`;

/** The theme's red and green on removed and added lines, stronger on the words that changed. */
const diffTheme = EditorView.theme({
  ".cm-changedLine, .cm-insertedLine": { backgroundColor: band("ok", 12) },
  ".cm-deletedLine, .cm-deletedChunk, .cm-mergeView .cm-merge-a .cm-changedLine": {
    backgroundColor: band("err", 12),
  },
  ".cm-changedText, .cm-insertedLine .cm-changedText": { background: band("ok", 30) },
  ".cm-deletedText, .cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText": {
    background: band("err", 30),
  },
  ".cm-changedLineGutter, .cm-insertedLineGutter": { background: "var(--ok)" },
  ".cm-deletedLineGutter, .cm-merge-a .cm-changedLineGutter": { background: "var(--err)" },
  ".cm-collapsedLines": {
    background: "var(--surface-2)",
    color: "var(--muted)",
    fontFamily: "var(--font)",
    fontSize: "0.75rem",
    padding: "0.125rem 0.75rem",
    cursor: "pointer",
  },
  ".cm-collapsedLines:before": { content: "none" },
  ".cm-collapsedLines:after": { content: "none" },
});

/** A read-only view's extensions: the grammar, the theme, line numbers. */
async function baseOf(language: EditorLanguage | null, label: string): Promise<Extension[]> {
  return [
    lineNumbers(),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.contentAttributes.of({ "aria-label": label }),
    EditorView.lineWrapping,
    language === null ? [] : await grammarOf(language),
    syntaxHighlighting(editorHighlight),
    editorTheme,
    diffTheme,
  ];
}

export type DiffEditor = { readonly destroy: () => void; readonly next: (by: 1 | -1) => boolean };

const collapse = { margin: 3, minSize: 4 };

type Sides = { readonly before: string; readonly after: string };

const step = (target: EditorView, by: 1 | -1): boolean =>
  (by === 1 ? goToNextChunk : goToPreviousChunk)(target);

function sideBySide(parent: HTMLElement, sides: Sides, base: readonly Extension[]): DiffEditor {
  const view = new MergeView({
    a: { doc: sides.before, extensions: base },
    b: { doc: sides.after, extensions: base },
    parent,
    gutter: true,
    highlightChanges: true,
    collapseUnchanged: collapse,
  });
  return {
    destroy: () => {
      view.destroy();
    },
    next: (by) => step(view.b, by),
  };
}

function inline(parent: HTMLElement, sides: Sides, base: readonly Extension[]): DiffEditor {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: sides.after,
      extensions: [
        ...base,
        unifiedMergeView({
          original: sides.before,
          gutter: true,
          highlightChanges: true,
          mergeControls: false,
          syntaxHighlightDeletions: true,
          collapseUnchanged: collapse,
        }),
      ],
    }),
  });
  return {
    destroy: () => {
      view.destroy();
    },
    next: (by) => step(view, by),
  };
}

/** Both sides with a final newline when neither has one (a cell's source): lines added after the last one then leave
 * it unchanged, as git's diff of two files that end in a newline. */
const ended = (sides: Sides): Sides =>
  sides.before.endsWith("\n") || sides.after.endsWith("\n")
    ? sides
    : { before: `${sides.before}\n`, after: `${sides.after}\n` };

/** Mounts the diff of `before` and `after` in `parent`, side by side or inline. */
export async function mountDiff(
  parent: HTMLElement,
  sides: Sides,
  options: {
    readonly language: EditorLanguage | null;
    readonly sideBySide: boolean;
    readonly label: string;
  },
): Promise<DiffEditor> {
  const base = await baseOf(options.language, options.label);
  return (options.sideBySide ? sideBySide : inline)(parent, ended(sides), base);
}

/** Mounts one read-only side (an added, removed or unchanged cell) in `parent`. */
export async function mountText(
  parent: HTMLElement,
  text: string,
  options: { readonly language: EditorLanguage | null; readonly label: string },
): Promise<{ readonly destroy: () => void }> {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: await baseOf(options.language, options.label),
    }),
  });
  return {
    destroy: () => {
      view.destroy();
    },
  };
}
