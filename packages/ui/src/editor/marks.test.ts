// What the cell editor draws beyond CodeMirror's defaults: each line's hang for a wrapped continuation (its own indent
// as columns, capped), the failing line's mark in the gutter, and the selection layer on the text. Where the selection
// ends on screen is the browser's to measure: the editing journey (e2e/cells-editor.spec.ts) checks it.
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { failedLineOf, hangingIndent, hangMax, hangRules, textSelection } from "./marks.js";

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

const open = (doc: string, extra: Parameters<typeof EditorState.create>[0] = {}) => {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc, ...extra }),
  });
  return view;
};

describe("hangingIndent", () => {
  it("gives each line the hang of its own indent, tabs as their columns, the deepest capped", () => {
    const shown = open(`a\n    b\n\tc\n${" ".repeat(40)}d`, {
      extensions: [EditorState.tabSize.of(2), EditorView.lineWrapping, hangingIndent],
    });
    const hangs = [...shown.contentDOM.querySelectorAll(".cm-line")].map(
      (line) => [...line.classList].find((name) => name.startsWith("cm-hang-")) ?? "",
    );
    expect(hangs).toEqual(["cm-hang-0", "cm-hang-4", "cm-hang-2", `cm-hang-${String(hangMax)}`]);
    shown.dispatch({ changes: { from: 0, insert: "  " } });
    expect(shown.contentDOM.querySelector(".cm-line")?.className).toContain("cm-hang-2");
  });

  it("pads each depth two columns past its indent and pulls the first visual line back out", () => {
    expect(hangRules[".cm-line.cm-hang-0"]).toEqual({
      paddingInlineStart: "2ch",
      textIndent: "-2ch",
    });
    expect(hangRules[`.cm-line.cm-hang-${String(hangMax)}`]).toEqual({
      paddingInlineStart: `${String(hangMax + 2)}ch`,
      textIndent: `-${String(hangMax + 2)}ch`,
    });
  });
});

describe("failedLineOf", () => {
  it("marks the number of the line the run failed at, and nothing for a line the text no longer has", () => {
    const marked = (line: number | null) => {
      const shown = open("a\nb\nc", { extensions: [lineNumbers(), failedLineOf(line)] });
      const found = [...shown.dom.querySelectorAll(".cm-gutterElement.cm-failedLine")].map(
        (element) => element.textContent,
      );
      shown.destroy();
      view = undefined;
      return found;
    };
    expect(marked(2)).toEqual(["2"]);
    expect(marked(9)).toEqual([]);
    expect(marked(0)).toEqual([]);
    expect(marked(null)).toEqual([]);
  });
});

describe("textSelection", () => {
  it("draws a layer of its own for the selected text, under the text", () => {
    const shown = open("const a = 1;\nconst b = 2;", {
      extensions: [textSelection],
      selection: EditorSelection.range(2, 16),
    });
    const layer = shown.dom.querySelector<HTMLElement>(".cm-textSelectionLayer");
    expect(layer).not.toBeNull();
    expect(Number(layer?.style.zIndex)).toBeLessThan(0);
  });
});
