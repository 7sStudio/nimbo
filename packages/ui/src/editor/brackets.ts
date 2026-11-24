// Bracket pairs and indent guides in a code cell: each bracket
// takes one of three colours by its depth; each indent level of a line's leading space draws a thin guide; the guide of
// the block holding the caret is darker and the innermost pair around the caret is boxed. Brackets are the grammar's
// own tokens, so one inside a string or a comment is never counted.
import { indentUnit, syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { countColumn } from "@codemirror/state";
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import { Decoration, ViewPlugin } from "@codemirror/view";

const opening: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };
const closing = new Set([")", "]", "}"]);

/** A matched pair: where its two brackets are, and how deep it sits (0 outermost). */
export type Pair = { readonly open: number; readonly close: number; readonly depth: number };

/** Every bracket of the text by the grammar's tokens, each with its depth, and the pairs they make. */
export function bracketsOf(state: EditorState): {
  readonly marks: readonly { readonly at: number; readonly depth: number }[];
  readonly pairs: readonly Pair[];
} {
  const marks: { at: number; depth: number }[] = [];
  const pairs: Pair[] = [];
  const stack: { readonly at: number; readonly close: string }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      const name = node.name;
      const close = opening[name];
      if (close !== undefined) {
        marks.push({ at: node.from, depth: stack.length });
        stack.push({ at: node.from, close });
      } else if (closing.has(name)) {
        const top = stack.at(-1);
        if (top?.close === name) stack.pop();
        marks.push({ at: node.from, depth: stack.length });
        if (top?.close === name)
          pairs.push({ open: top.at, close: node.from, depth: stack.length });
      }
    },
  });
  return { marks, pairs };
}

/** The innermost pair around `at` (its brackets included), and the innermost one that spans several lines. */
export function scopeOf(
  state: EditorState,
  pairs: readonly Pair[],
  at: number,
): { readonly pair: Pair | undefined; readonly block: Pair | undefined } {
  const around = pairs
    .filter((pair) => pair.open < at && at <= pair.close)
    .sort((a, b) => b.depth - a.depth);
  const lineOf = (pos: number) => state.doc.lineAt(pos).number;
  return {
    pair: around[0],
    block: around.find((pair) => lineOf(pair.close) - lineOf(pair.open) > 1),
  };
}

const bracket = [1, 2, 3].map((n) => Decoration.mark({ class: `cm-bracket-${String(n)}` }));
const scoped = Decoration.mark({ class: "cm-scopeBracket" });
const guide = Decoration.mark({ class: "cm-guide" });
const guideOn = Decoration.mark({ class: "cm-guide cm-guide-on" });

/** The guides of one line: a mark on each indent unit of its leading space; the one at column `on` darker. */
function guidesOf(state: EditorState, line: number, on: number | null): Range<Decoration>[] {
  const { from, text } = state.doc.line(line);
  const unit = Math.max(1, countColumn(state.facet(indentUnit), state.tabSize));
  const lead = /^[\t ]*/u.exec(text)?.[0] ?? "";
  const marks: Range<Decoration>[] = [];
  let start = 0;
  for (let index = 1; index <= lead.length; index += 1) {
    const column = countColumn(lead.slice(0, index), state.tabSize);
    const begin = countColumn(lead.slice(0, start), state.tabSize);
    if (column - begin >= unit) {
      marks.push((begin === on ? guideOn : guide).range(from + start, from + index));
      start = index;
    }
  }
  return marks;
}

/** The lines inside the block around the caret and the column of its guide: its opening line's indentation. */
function blockOf(state: EditorState, block: Pair | undefined) {
  if (block === undefined) return null;
  const open = state.doc.lineAt(block.open);
  return {
    first: open.number + 1,
    last: state.doc.lineAt(block.close).number - 1,
    column: countColumn(/^[\t ]*/u.exec(open.text)?.[0] ?? "", state.tabSize),
  };
}

/** The decorations of the visible lines: brackets coloured, the caret's pair boxed, the guides drawn. */
function decorationsOf(view: EditorView): DecorationSet {
  const { state } = view;
  const { marks, pairs } = bracketsOf(state);
  const { pair, block } = scopeOf(state, pairs, state.selection.main.head);
  const ranges: Range<Decoration>[] = marks.map(({ at, depth }) =>
    (bracket[depth % 3] ?? guide).range(at, at + 1),
  );
  if (pair !== undefined)
    ranges.push(scoped.range(pair.open, pair.open + 1), scoped.range(pair.close, pair.close + 1));
  const lines = blockOf(state, block);
  for (const { from, to } of view.visibleRanges) {
    for (let line = state.doc.lineAt(from).number; line <= state.doc.lineAt(to).number; line += 1) {
      const inBlock = lines !== null && line >= lines.first && line <= lines.last;
      ranges.push(...guidesOf(state, line, inBlock ? lines.column : null));
    }
  }
  return Decoration.set(ranges, true);
}

/** Colours the brackets, draws the indent guides and marks the caret's scope; again on every change that moves them. */
export const bracketsAndGuides = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorationsOf(view);
    }
    update(update: ViewUpdate): void {
      const parsed = syntaxTree(update.state) !== syntaxTree(update.startState);
      if (update.docChanged || update.selectionSet || update.viewportChanged || parsed)
        this.decorations = decorationsOf(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
