// What the cell editor draws beyond CodeMirror's defaults: the selection tints only the
// selected text, a line's end only as far as the half-character that says its line break is selected, never the whole
// row out to the right edge; a wrapped line's continuation hangs under its own text, two columns in; the number of
// the line the last run failed at is marked in the gutter, and the numbers of the lines an agent changed that no one
// reviewed yet are tinted violet.
import type { Extension, Range } from "@codemirror/state";
import { countColumn, EditorSelection, RangeSet } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import {
  Decoration,
  GutterMarker,
  gutterLineClass,
  layer,
  lineNumberMarkers,
  RectangleMarker,
  ViewPlugin,
} from "@codemirror/view";

/** The selected text of every non-empty range, one doc line at a time, and a mark at a line's end where the range goes
 * on past its line break. */
function textRectangles(view: EditorView): RectangleMarker[] {
  const { doc } = view.state;
  const marks: RectangleMarker[] = [];
  for (const range of view.state.selection.ranges) {
    const from = Math.max(range.from, view.viewport.from);
    const to = Math.min(range.to, view.viewport.to);
    for (let pos = from; !range.empty && pos <= to;) {
      const line = doc.lineAt(pos);
      const start = Math.max(range.from, line.from);
      const end = Math.min(range.to, line.to);
      if (end > start)
        marks.push(
          ...RectangleMarker.forRange(view, "cm-textSelection", EditorSelection.range(start, end)),
        );
      if (range.to > line.to)
        marks.push(
          ...RectangleMarker.forRange(
            view,
            "cm-lineBreakSelection",
            EditorSelection.cursor(line.to),
          ),
        );
      pos = line.to + 1;
    }
  }
  return marks;
}

/** The selection on the text alone, on a layer under it (CodeMirror's own full-row layer is left transparent). */
export const textSelection: Extension = layer({
  above: false,
  class: "cm-textSelectionLayer",
  markers: textRectangles,
  update: (update: ViewUpdate) =>
    update.docChanged || update.selectionSet || update.viewportChanged,
});

/** The widest indent a continuation follows, in columns: a deeper line hangs at this depth. */
export const hangMax = 24;

const hangs = Array.from({ length: hangMax + 1 }, (_, columns) =>
  Decoration.line({ class: `cm-hang-${String(columns)}` }),
);

/** Every visible line's hang: its leading spaces and tabs as columns, capped. */
function hangsOf(view: EditorView): DecorationSet {
  const { doc, tabSize } = view.state;
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos);
      const lead = /^[\t ]*/u.exec(line.text)?.[0] ?? "";
      const hang = hangs[Math.min(countColumn(lead, tabSize), hangMax)];
      if (hang !== undefined) ranges.push(hang.range(line.from));
      pos = line.to + 1;
    }
  }
  return Decoration.set(ranges);
}

/** A wrapped line's continuation starts two columns in from the line's own text (theme.ts draws each depth). */
export const hangingIndent: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = hangsOf(view);
    }
    update(update: ViewUpdate): void {
      const tab = update.startState.tabSize !== update.state.tabSize;
      if (update.docChanged || update.viewportChanged || tab)
        this.decorations = hangsOf(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

class FailedLine extends GutterMarker {
  override elementClass = "cm-failedLine";
}
const failed = new FailedLine();

/** The gutter's mark on line `line` (1-based) of the text, where the last run failed; nothing for null or a line the
 * text no longer has. */
export function failedLineOf(line: number | null): Extension {
  if (line === null) return [];
  return gutterLineClass.compute(["doc"], (state) =>
    RangeSet.of<GutterMarker>(
      line < 1 || line > state.doc.lines ? [] : [failed.range(state.doc.line(line).from)],
    ),
  );
}

/** A line number an agent changed: the number itself in its element, so the number gutter draws it in place of its
 * own. The gutter is hidden from assistive technology; the cell's own button names the edit (cells/AgentMarks.vue). */
class AgentNumber extends GutterMarker {
  override elementClass = "cm-agentLine";
  constructor(readonly number: number) {
    super();
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof AgentNumber && other.number === this.number;
  }
  override toDOM(): Node {
    const span = document.createElement("span");
    span.textContent = String(this.number);
    span.dataset.agentLine = String(this.number);
    return span;
  }
}

/** The lines an agent changed (1-based) and the words that name its edit (its button's name). */
export type AgentLines = { readonly lines: readonly number[]; readonly label: string };

/** The violet numbers of `lines` (1-based, sorted) an agent changed; a line the text no longer has is left out. */
function agentLinesOf(lines: readonly number[]): Extension {
  if (lines.length === 0) return [];
  return lineNumberMarkers.compute(["doc"], (state) =>
    RangeSet.of<GutterMarker>(
      lines
        .filter((line) => line >= 1 && line <= state.doc.lines)
        .map((line) => new AgentNumber(line).range(state.doc.line(line).from)),
    ),
  );
}

/** The violet numbers of `agent`'s lines; nothing for none. */
export const agentOf = (agent: AgentLines | null | undefined): Extension =>
  agent === null || agent === undefined ? [] : agentLinesOf(agent.lines);

/** The hang of each depth, for the editor's theme: padding as deep as the hang and the first visual line pulled back
 * out by as much. */
export const hangRules = Object.fromEntries(
  hangs.map((_, columns) => [
    `.cm-line.cm-hang-${String(columns)}`,
    {
      paddingInlineStart: `${String(columns + 2)}ch`,
      textIndent: `-${String(columns + 2)}ch`,
    },
  ]),
);
