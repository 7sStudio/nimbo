// The query bar as a user drives it: its modes, typing in its CodeMirror input and pressing keys there, and its buttons.
import { EditorView } from "@codemirror/view";

/** The CodeMirror view inside the query input. */
function editor(): EditorView {
  const content = document.querySelector<HTMLElement>(".cm-content");
  const view = content ? EditorView.findFromDOM(content) : null;
  if (view === null) throw new Error("no query input");
  return view;
}

/** Types `text` as the whole query, as a user would. */
export function typeQuery(text: string): void {
  const view = editor();
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

/** Presses a key in the query input (↩, ⌘↩, Esc, ↑, ↓, ?). */
export function pressInQuery(key: string, init: KeyboardEventInit = {}): void {
  document
    .querySelector(".cm-content")
    ?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
    );
}

/** The query input's text. */
export const queryText = (): string => editor().state.doc.toString();

/** A segment of the bar's controls by its label (a pending mode reads "jq, 1.5 MB": the label is before ", "). */
export const segment = (label: string): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>('[data-part="segment"]')].find(
    (s) => s.textContent.trim().split(", ")[0] === label,
  );

/** A button by its text. */
export const button = (text: string): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent.trim() === text);
