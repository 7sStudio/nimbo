// F2 rename: CodeMirror's dialog at the name, prefilled, as the library's own rename shows
// it; Enter sends the drafts and asks the daemon (language.rename), which edits every cell, folded or not, in one turn.
// The edits come back as cell.updated; a refusal is shown in a dialog of its own.
import type { EditorView } from "@codemirror/view";
import { getDialog, showDialog } from "@codemirror/view";

import type { LanguageHost } from "./types.js";

const panelClass = "cm-nimboRename";

/** The 0-based line and character of `offset` in the view's document. */
function positionAt(view: EditorView, offset: number) {
  const line = view.state.doc.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
}

function refused(view: EditorView, reason: string): void {
  const { close, result } = showDialog(view, {
    label: reason,
    submitLabel: "OK",
    class: panelClass,
  });
  void result.then(() => {
    view.dispatch({ effects: close });
  });
}

/** Opens the rename dialog at the name under the caret; false when there is none (the key goes on). */
export function renameAt(view: EditorView, host: LanguageHost, cell: string): boolean {
  if (host.readOnly()) return false;
  const word = view.state.wordAt(view.state.selection.main.head);
  if (!word) return false;
  const name = view.state.sliceDoc(word.from, word.to);
  const open = getDialog(view, panelClass);
  if (open) {
    const input = open.dom.querySelector("input");
    if (input) {
      input.value = name;
      input.select();
    }
    return true;
  }
  const at = positionAt(view, word.from);
  const { close, result } = showDialog(view, {
    label: "Rename to",
    input: { name: "name", value: name, "aria-label": "New name" },
    focus: true,
    submitLabel: "Rename",
    class: panelClass,
  });
  void result.then(async (form) => {
    view.dispatch({ effects: close });
    const field = form?.elements.namedItem("name");
    const next = field instanceof HTMLInputElement ? field.value.trim() : "";
    if (next === "" || next === name) return;
    const reason = await host.rename(cell, at, next);
    if (reason !== null) refused(view, reason);
  });
  return true;
}
