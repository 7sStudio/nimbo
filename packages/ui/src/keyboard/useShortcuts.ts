// The page's keyboard: one keydown listener on the window, in the capture phase so a row bound in edit
// mode wins over the editor, that finds the binding for the key where the page and the focus are (core's bindingFor
// over the live registry, keymap.ts) and dispatches its command.
// A chord's second key must come within 1 s. `createShortcuts` is the logic; `useShortcuts` mounts it in a component.
import { onBeforeUnmount, onMounted } from "vue";

import type { Keybinding } from "@jsnb/core";
import { bindingFor, startsChord } from "@jsnb/core";

import type { Dispatcher, KeyContext } from "../commands/dispatch.js";
import type { KeyMode, KeyPage } from "./keymap.js";
import { keyPage, keyTable } from "./keymap.js";
import type { Focus } from "./modes.js";
import { comboOf, focusOf, isMac, modesOf } from "./modes.js";

export const chordMs = 1000;

type Options = {
  readonly mac: boolean;
  /** Milliseconds, for the chord window; performance.now by default. */
  readonly now?: () => number;
  /** The bindings, read at each key so a saved binding applies at once; the live registry by default. */
  readonly table?: () => readonly Keybinding[];
  /** The page the keys act on (its when clauses' `home` or `notebook`). */
  readonly page?: KeyPage;
};

type Pressed = Pick<
  KeyboardEvent,
  "code" | "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "preventDefault" | "repeat"
> & { readonly target: EventTarget | null };

const focusFrom = (target: EventTarget | null): Focus =>
  typeof Element !== "undefined" && target instanceof Element ? focusOf(target) : "none";

const modeKeys: Readonly<Record<KeyMode, readonly string[]>> = {
  any: [],
  command: ["commandMode"],
  edit: ["editMode"],
  markdown: ["markdownEditing"],
};

/** The context keys that hold on `page` with `modes` (modesOf's), for the when clauses. */
const contextOf = (page: KeyPage, modes: readonly KeyMode[]): ReadonlySet<string> =>
  new Set([page, ...modes.flatMap((mode) => modeKeys[mode])]);

/** The keys an output viewer handles where its tree, grid or toolbar has the focus ('s last row): moving,
 * copying, find, the query bar and full screen; every other key is the page's. */
const viewerKeys = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "Mod+C",
  "Mod+Alt+C",
  "Mod+F",
  "Mod+Shift+F",
  "Mod+Shift+O",
]);

/** A focused button, link or the resizer: Enter and Space are its own (they activate it), never ↩'s edit mode. */
const activates = (combo: string, focus: Focus): boolean =>
  focus === "control" && (combo === "Enter" || combo === "Space");

/** A menu or dialog of the page's with the focus in it keeps every key but Escape, so a run never starts under a
 * "Restart anyway?"; Escape stays the page's (ui.escape closes the overlay, and preventing its default keeps Reka's
 * toasts from closing on the same key; in a submenu ← closes one level, as Reka has it). A text field or an open
 * overlay keeps its keys: only the ⌘ rows and Escape reach the page then; a focused control keeps Enter and
 * Space. A viewer's own field (its query bar) or full-screen dialog keeps every key but the page's other ⌘ rows (⌘K, ⌘B…), Esc and ⌘↩ (the
 * bar's run-and-pin) included; its tree, grid or toolbar keeps only its navigation and copy keys. */
/** What an output viewer keeps, its field or its tree; undefined for any other focus. */
function keptByViewer(combo: string, focus: Focus): boolean | undefined {
  if (focus === "outputField")
    return !combo.includes("Mod+") || viewerKeys.has(combo) || combo === "Mod+Enter";
  return focus === "output" ? viewerKeys.has(combo) : undefined;
}

/** A ⌘ row, a Control Shift one (VS Code's ⌃⇧G on macOS) or a function key (the debugger's F5, F10): the page's even
 * from a text field, whose own Control keys (⌃A, ⌃E) have no Shift and which has no use for F keys. */
const windowCombo = (combo: string): boolean =>
  combo.includes("Mod+") || combo.startsWith("Ctrl+Shift+") || /(?:^|\+)F\d{1,2}$/u.test(combo);

function keptByFocus(combo: string, focus: Focus, overlay: boolean): boolean {
  if (focus === "capture" || focus === "menu") return true;
  if (focus === "overlay") return combo !== "Escape";
  if (activates(combo, focus)) return true;
  return (
    keptByViewer(combo, focus) ??
    ((focus === "field" || overlay) && !windowCombo(combo) && combo !== "Escape")
  );
}

/** The binding for `combo` (after `first`, a chord's first key) where `context` holds. With a menu or dialog open only
 * Escape and the ⌘ rows reach here (keptByFocus), with no mode: Escape closes the overlay, never a mode's own Escape
 * (a markdown card's render would close the card under its own menu). */
function rowFor(
  table: readonly Keybinding[],
  combo: string,
  first: string | undefined,
  context: ReadonlySet<string>,
): Keybinding | undefined {
  return (
    (first === undefined ? undefined : bindingFor(table, `${first} ${combo}`, context)) ??
    bindingFor(table, combo, context)
  );
}

/** Esc in an editor whose completion list or signature help is open closes it (the editor's own key), not edit mode. */
const closesCompletion = (combo: string, target: EventTarget | null): boolean =>
  combo === "Escape" &&
  typeof Element !== "undefined" &&
  target instanceof Element &&
  (target
    .closest(".cm-editor")
    ?.querySelector(".cm-tooltip-autocomplete, .cm-lsp-signature-tooltip") ?? null) !== null;

/** The commands whose keys still act while an editor such as Settings covers the notebook or the list: the window's own,
 * as VS Code's work over any editor. Cmd S is left to the editor (Settings (JSON) saves its file). */
const windowKeys = new Set([
  "ui.palette.open",
  "ui.shortcuts.open",
  "ui.settings.open",
  "ui.panel.toggle",
  "ui.panel.open",
  "ui.inspector.toggle",
  "ui.bottom.toggle",
  "ui.home.side.toggle",
  "ui.home.view.open",
  "ui.diff.next",
  "ui.diff.previous",
  "ui.escape",
  "ui.feedback.list",
]);

/** The row a key acts with: under an editor that covers the notebook (Settings) only the window's keys act, never a
 * hidden cell's. */
const acting = (row: Keybinding | undefined, context: KeyContext): Keybinding | undefined =>
  context.page === true && !windowKeys.has(row?.command ?? "") ? undefined : row;

/** Under Settings, Cmd S outside an editor saves nothing, and never opens the browser's "Save page as". */
const swallowsSave = (combo: string, focus: Focus, context: KeyContext): boolean =>
  context.page === true && combo === "Mod+S" && focus !== "editor";

/** The rows that work wherever the focus is, a text field, a menu or a dialog included: feedback mode is turned on to
 * write about exactly those. Only the Keyboard Shortcuts editor recording a key keeps them. */
const anywhere = new Set(["ui.feedback.toggle"]);

/** Before the modes: "ran" when `combo` is a row that works wherever the focus is (run here), "kept" when the focus
 * keeps the key (keptByFocus), else undefined. */
function before(
  dispatcher: Dispatcher,
  table: readonly Keybinding[],
  key: { readonly combo: string; readonly focus: Focus; readonly overlay: boolean },
  event: Pressed,
): "ran" | "kept" | undefined {
  const { combo, focus } = key;
  const row = table.find((each) => anywhere.has(each.command) && each.key === combo);
  if (row !== undefined && focus !== "capture") {
    event.preventDefault();
    void dispatcher.dispatch(row.command, row.args);
    return "ran";
  }
  return keptByFocus(combo, focus, key.overlay) ? "kept" : undefined;
}

/** Returns the handler: true when the key was used (it then prevents the browser's default). */
export function createShortcuts(dispatcher: Dispatcher, options: Options) {
  const { mac, now = () => performance.now(), table: read = keyTable, page = "notebook" } = options;
  let pending: { readonly key: string; readonly at: number } | undefined;

  /** A chord's first key while its window is open, then forgotten either way. */
  const takePending = (): string | undefined => {
    const key = pending !== undefined && now() - pending.at <= chordMs ? pending.key : undefined;
    pending = undefined;
    return key;
  };

  return (event: Pressed): boolean => {
    const combo = comboOf(event, mac);
    const table = read();
    if (combo === undefined || event.repeat || closesCompletion(combo, event.target)) return false;
    const context = dispatcher.context();
    const focus = focusFrom(event.target);
    const modes = modesOf(context, focus);
    const first = takePending();
    const early = before(dispatcher, table, { combo, focus, overlay: context.overlay }, event);
    if (early !== undefined) return early === "ran";
    const where = contextOf(page, context.overlay ? ["any"] : modes);
    const row = acting(rowFor(table, combo, first, where), context);
    if (row === undefined) {
      if (startsChord(table, combo, contextOf(page, modes))) pending = { key: combo, at: now() };
      // true makes the listener prevent the browser's default (a chord's first key, Cmd S under Settings)
      return pending !== undefined || swallowsSave(combo, focus, context);
    }
    event.preventDefault();
    void dispatcher.dispatch(row.command, row.args);
    return true;
  };
}

/** Listens on the window while the calling component is mounted; `page` is the page the when clauses see (Home or a
 * notebook), and the one menus and tooltips read their keys for. */
export function useShortcuts(dispatcher: Dispatcher, page: KeyPage = "notebook"): void {
  keyPage.value = page;
  const handle = createShortcuts(dispatcher, { mac: isMac(navigator.userAgent), page });
  const listener = (event: KeyboardEvent) => {
    if (handle(event)) event.preventDefault();
  };
  onMounted(() => {
    window.addEventListener("keydown", listener, { capture: true });
  });
  onBeforeUnmount(() => {
    window.removeEventListener("keydown", listener, { capture: true });
  });
}
