// Which keymap rows apply: command mode (no editor focused) or edit mode (a cell's editor focused, with
// the markdown rows first on a markdown cell), and a key event read as the keymap writes keys ("Mod+Shift+Enter").
import type { KeyContext } from "../commands/dispatch.js";

/** The keyboard mode a binding acts in. */
export type KeyMode = "any" | "command" | "edit" | "markdown";

/** What has the focus: a cell's CodeMirror editor, another text field, an output viewer (its tree, grid or toolbar,
 * which keep their navigation and copy keys), a text field of a viewer, its full-screen dialog or an
 * editor's find row (which keep their keys but the page's ⌘ rows), a button or another control that Enter and Space activate (the rail,
 * a panel's rows, the resizer), one of the page's menus or dialogs (`data-overlay`: it keeps every key but Escape), a menu Reka closes on its own
 * (`data-overlay="menu"`: it keeps every key, Escape included), or
 * nothing that takes keys. */
export type Focus =
  | "editor"
  | "field"
  | "output"
  | "outputField"
  | "control"
  | "overlay"
  | "menu"
  | "capture"
  | "none";

const fields = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
const controls = "button, a[href], summary, [role='separator'][tabindex]";
/** The rail and the side panel keep their own unmodified keys: a user whose focus is in the Errors panel
 * never deletes a cell with D D or restarts the kernel with 0 0; only the ⌘ rows and Escape reach the page from there. */
const ownKeys = "[data-keys='own']";

/** A focus that keeps its own keys: an output viewer's (its tree, its fields, its full-screen dialog) or an editor's
 * find row (editor/findRow.ts), whose Enter and Shift Enter step through the matches and whose Esc closes it. */
function ownFocus(element: Element): Focus | undefined {
  // an output viewer's full-screen dialog keeps the keys while it is open, wherever the focus is
  if (element.ownerDocument.querySelector('[data-part="dialog"]') !== null) return "outputField";
  if (element.closest('[data-part="output"], .jsnb-ov') !== null)
    return element.closest(fields) === null ? "output" : "outputField";
  return element.closest(".cm-panels") === null ? undefined : "outputField";
}

export function focusOf(element: Element | null): Focus {
  if (element === null) return "none";
  // the Keyboard Shortcuts editor recording a key: every key, Escape included, is the one being recorded
  if (element.closest("[data-keys='capture']") !== null) return "capture";
  // a Reka menu the page does not track (the menu bar, the gear, Home's right-click menu) closes itself on Escape
  // an output viewer's own menus (Export, Copy) are Reka menus too: Escape closes them, never the page's ui.escape
  if (element.closest("[data-overlay='menu'], [role='menu']") !== null) return "menu";
  if (element.closest("[data-overlay]") !== null) return "overlay";
  const own = ownFocus(element);
  if (own !== undefined) return own;
  if (element.closest(".cm-editor") !== null) return "editor";
  if (element.closest(fields) !== null || element.closest(ownKeys) !== null) return "field";
  return element.closest(controls) === null ? "none" : "control";
}

/** The modes whose rows apply, most specific first; a text field outside the cells, or a viewer's own field, leaves
 * only "any"; a viewer's tree or toolbar reads as command mode (its own keys are kept by the shortcuts). */
export function modesOf(context: KeyContext, focus: Focus): readonly KeyMode[] {
  if (focus === "outputField") return ["any"];
  if (focus === "editor" || context.mode === "edit") {
    return context.cellType === "markdown" ? ["markdown", "edit", "any"] : ["edit", "any"];
  }
  return focus === "field" ? ["any"] : ["command", "any"];
}

const named: Readonly<Record<string, string>> = {
  Period: ".",
  Comma: ",",
  Slash: "/",
  BracketLeft: "[",
  BracketRight: "]",
  Space: "Space",
};

/** The key of an event as the keymap names it. A letter or digit is the one the user's layout types (`key`), as VS
 * Code reads it, so W is W on AZERTY too (its physical key is QWERTY's Z, whose `code` is KeyZ); where the layout types
 * no plain letter or digit there (⌥ changes `key` on macOS, AZERTY's digit row types "&é…"), the physical key. */
function keyOf(event: Pick<KeyboardEvent, "code" | "key">): string | undefined {
  const { code, key } = event;
  if (/^[a-z0-9]$/iu.test(key)) return key.toUpperCase();
  // punctuation the keymap names (Cmd ,) by what the layout types too: AZERTY's comma is on QWERTY's M
  if ([",", ".", "/", "[", "]"].includes(key)) return key;
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (named[code] !== undefined) return named[code];
  if (["Shift", "Meta", "Control", "Alt", "Dead", "Unidentified"].includes(key)) return undefined;
  return key.length === 1 ? key.toUpperCase() : key;
}

type KeyEvent = Pick<KeyboardEvent, "code" | "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** "Mod+Alt+Shift+K"; undefined for a lone modifier. `mac`: ⌘ is Mod and ⌃ is Ctrl; elsewhere Ctrl is Mod. */
export function comboOf(event: KeyEvent, mac: boolean): string | undefined {
  const key = keyOf(event);
  if (key === undefined) return undefined;
  const mod = mac ? event.metaKey : event.ctrlKey;
  const parts = [
    ...(mod ? ["Mod"] : []),
    ...(mac && event.ctrlKey ? ["Ctrl"] : []),
    ...(event.altKey ? ["Alt"] : []),
    ...(event.shiftKey ? ["Shift"] : []),
    key,
  ];
  return parts.join("+");
}

/** True on macOS, where ⌘ is the command key; `agent` is navigator.userAgent. */
export const isMac = (agent: string): boolean => /Macintosh|Mac OS X/.test(agent);
