// The editor's own keys (edit mode): ↑ on the first line and ↓ on the last move into the neighbour cell's
// editor; Tab accepts the open completion as ↩ does, else indents (Esc then Tab leaves the editor);
// the rest are CodeMirror's defaults (comment, select next, indent, move line, search, undo). The page's keymap takes the run keys and Esc before CodeMirror
// sees them (keyboard/useShortcuts.ts listens in the capture phase).
import {
  acceptCompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { keymap } from "@codemirror/view";

export type Leave = "previous" | "next";

/** True when the selection is one caret on the document's first (`previous`) or last (`next`) line. */
export function atEdge(view: EditorView, edge: Leave): boolean {
  const { main, ranges } = view.state.selection;
  if (ranges.length !== 1 || !main.empty) return false;
  const line = view.state.doc.lineAt(main.head).number;
  return edge === "previous" ? line === 1 : line === view.state.doc.lines;
}

/** The editing keys, with `leave` called when ↑ or ↓ would leave the document. */
export function editorKeys(leave: (edge: Leave) => void): Extension {
  const edge = (to: Leave) => (view: EditorView) => {
    if (!atEdge(view, to)) return false;
    leave(to);
    return true;
  };
  return [
    history(),
    closeBrackets(),
    keymap.of([
      // an open completion list takes ↑ and ↓ first, even on the first or last line
      ...completionKeymap,
      { key: "ArrowUp", run: edge("previous") },
      { key: "ArrowDown", run: edge("next") },
      ...closeBracketsKeymap,
      { key: "Tab", run: acceptCompletion },
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
      indentWithTab,
    ]),
  ];
}
