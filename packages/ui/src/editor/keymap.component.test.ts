// The editor's own keys: ↑ on the first line and ↓ on the last leave the document for the neighbour's
// editor; anywhere else, or with a selection, they move inside it.
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import type { Leave } from "./keymap.js";
import { atEdge, editorKeys } from "./keymap.js";

function view(doc: string, at: number, left: Leave[]): EditorView {
  const parent = document.createElement("div");
  document.body.replaceChildren(parent);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: editorKeys((edge) => left.push(edge)),
    }),
  });
}
const press = (target: EditorView, key: string) =>
  target.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );

describe("editorKeys", () => {
  it("leaves at the first and last lines only", () => {
    const left: Leave[] = [];
    const top = view("a\nb", 0, left);
    expect([atEdge(top, "previous"), atEdge(top, "next")]).toEqual([true, false]);
    press(top, "ArrowUp");
    press(top, "ArrowDown");
    const bottom = view("a\nb", 3, left);
    press(bottom, "ArrowDown");
    expect(left).toEqual(["previous", "next"]);
    bottom.dispatch({ selection: EditorSelection.range(0, 3) });
    expect(atEdge(bottom, "next")).toBe(false);
  });
});
