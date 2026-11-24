// The extras of a cell's editor, on real CodeMirror views with the code cells' grammar: brackets coloured
// by depth with the caret's pair boxed and its block's guide darker, the values at the lines' ends, and fenced code in
// the editor's colours, rendered and parsed. The find row is findRow.test.ts.
import { javascript } from "@codemirror/lang-javascript";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { bracketsAndGuides, bracketsOf, scopeOf } from "./brackets.js";
import { fenceParser } from "./fences.js";
import { lineValues, placed, setLineValues } from "./lineValues.js";
import { fenceHtml } from "./render.js";

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

const code = 'route("x", () => {\n  if (a) {\n    save({ id: [1] });\n  }\n});';
const parsed = (doc: string, extensions: Parameters<typeof EditorState.create>[0] = {}) => {
  const state = EditorState.create({
    doc,
    extensions: [javascript({ typescript: true }), extensions.extensions ?? []],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
};
const open = (state: EditorState) => {
  view = new EditorView({ parent: document.body, state });
  return view;
};

describe("brackets and guides", () => {
  it("gives each bracket its depth, pairs them, and finds the pair and the block around the caret", () => {
    const state = parsed(code);
    const { marks, pairs } = bracketsOf(state);
    expect(
      marks.map((mark) => `${state.sliceDoc(mark.at, mark.at + 1)}${String(mark.depth)}`),
    ).toEqual([
      "(0",
      "(1",
      ")1",
      "{1",
      "(2",
      ")2",
      "{2",
      "(3",
      "{4",
      "[5",
      "]5",
      "}4",
      ")3",
      "}2",
      "}1",
      ")0",
    ]);
    const inside = code.indexOf("id");
    const { pair, block } = scopeOf(state, pairs, inside);
    expect(pair === undefined ? "" : state.sliceDoc(pair.open, pair.close + 1)).toBe("{ id: [1] }");
    expect(block === undefined ? "" : state.sliceDoc(block.open, block.open + 1)).toBe("{");
    expect(block === undefined ? 0 : state.doc.lineAt(block.open).number).toBe(2);
    // a bracket inside a string is never counted
    expect(bracketsOf(parsed('"({["')).marks).toEqual([]);
  });
});

describe("brackets and guides drawn", () => {
  it("colours the brackets, boxes the caret's pair and darkens its block's guide", () => {
    const at = code.indexOf("id");
    const shown = open(
      parsed(code, { extensions: [bracketsAndGuides] }).update({
        selection: EditorSelection.cursor(at),
      }).state,
    );
    const dom = shown.contentDOM;
    expect(dom.querySelectorAll(".cm-bracket-1, .cm-bracket-2, .cm-bracket-3").length).toBe(16);
    expect([...dom.querySelectorAll(".cm-scopeBracket")].map((each) => each.textContent)).toEqual([
      "{",
      "}",
    ]);
    const lines = [...dom.querySelectorAll(".cm-line")];
    expect(lines[1]?.querySelectorAll(".cm-guide").length).toBe(1);
    expect(lines[2]?.querySelectorAll(".cm-guide").length).toBe(2);
    expect(lines[2]?.querySelectorAll(".cm-guide-on").length).toBe(1);
    shown.dispatch({ selection: EditorSelection.cursor(0) });
    expect(dom.querySelectorAll(".cm-guide-on").length).toBe(0);
  });
});

describe("values at the lines' ends", () => {
  const value = (name: string, text = name.toUpperCase()) =>
    [name, { name, text, full: text }] as const;

  it("places each name on the last top-level line that declares or assigns it, never inside a scope", () => {
    const source = [
      "const { a, b: c, d = () => { const z = 1 } } = o;", // 1: a, c, d; not b or z
      "let [e, ...f] = arr;", // 2
      "let y;", // 3: y is written again on 4
      "y = 5;", // 4
      "n++; obj.p = 1; -m;", // 5: n only
      "export const g: number = 2, h = 3;", // 6
      "const r = await q();", // 7
      "if (t) { const inner = 1; e = 2 }", // 8: nothing
      "function f2() { a = 3 }", // 9: nothing
      "const x = 1 + 1", // 10
    ].join("\n");
    const values = new Map(
      ["a", "b", "c", "d", "z", "e", "f", "y", "n", "m", "obj", "g", "h", "r", "inner", "x"].map(
        (name) => value(name),
      ),
    );
    const lines = placed(parsed(source), values).map((each) => [
      each.line,
      each.values.map((one) => one.name).join(" "),
    ]);
    expect(lines).toEqual([
      [1, "a c d"],
      [2, "e f"],
      [4, "y"],
      [5, "n"],
      [6, "g h"],
      [7, "r"],
      [10, "x"],
    ]);
    // a name the scope does not have shows nothing
    expect(placed(parsed("const k = 1;"), new Map())).toEqual([]);
  });
});

describe("values drawn", () => {
  const value = (name: string, text = name.toUpperCase()) =>
    [name, { name, text, full: text }] as const;

  it("shows one button per name, opens a name on click, and drops the values at the first edit", () => {
    const opened: string[] = [];
    const shown = open(
      parsed("const a = 1, b = 2;\nlet c = 3;", {
        extensions: [
          lineValues(new Map([value("a", "1"), value("b", "2")]), (name) => opened.push(name)),
        ],
      }),
    );
    const buttons = () => [...shown.dom.querySelectorAll<HTMLButtonElement>(".cm-lineValue-item")];
    expect(buttons().map((each) => each.textContent)).toEqual(["a: 1", "b: 2"]);
    buttons()[1]?.click();
    expect(opened).toEqual(["b"]);
    shown.dispatch({ effects: setLineValues.of(new Map([value("c", "3")])) });
    expect(buttons().map((each) => [each.textContent, each.dataset.name])).toEqual([["3", "c"]]);
    shown.dispatch({ changes: { from: 0, insert: "x" } });
    expect(buttons()).toEqual([]);
  });
});

describe("fenced code", () => {
  it("parses a JavaScript or TypeScript fence with the editor's grammar and leaves others as text", () => {
    expect(fenceParser("ts")).not.toBeNull();
    expect(fenceParser(" JavaScript title=x")).not.toBeNull();
    expect(fenceParser("python")).toBeNull();
    expect(fenceParser("")).toBeNull();
  });

  it("renders a fence in spans of the editor's tokens, its language said, any other as escaped text", () => {
    expect(fenceHtml('const a = "x";', "ts")).toBe(
      '<pre data-lang="ts"><code><span data-tok="kw">const</span> a = <span data-tok="str">&#34;x&#34;</span><span data-tok="punc">;</span></code></pre>\n',
    );
    expect(fenceHtml("<b>", "")).toBe("<pre><code>&#60;b&#62;</code></pre>\n");
  });
});
