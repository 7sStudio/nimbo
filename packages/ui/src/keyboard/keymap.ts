// The page's one live keybinding registry: core's default keys with the user's and the workspace's
// keybindings.json applied (resolveKeybindings), kept current by keybindings.changed (store/keybindings.ts). The keyboard
// listener, every menu's shortcut column, the palette, each tooltip and hint read their keys here, so a binding saved in
// the Keyboard Shortcuts editor, the JSON view, the CLI or by an agent shows everywhere at once. Keys: "Mod" is ⌘ on
// macOS and Ctrl elsewhere, "Ctrl" is the Control key; a space separates the two keys of a chord.
import type { Keybinding, KeybindingFiles } from "@jsnb/core";
import { liveKeybindings, resolveKeybindings, sameArgs } from "@jsnb/core";
import { computed, shallowRef } from "vue";

import type { Args } from "../commands/command.js";
import { isMac } from "./modes.js";

/** command: no editor focused; edit: an editor focused; markdown: editing a markdown cell; any: always. */
export type { KeyMode } from "./modes.js";

/** A row handled by CodeMirror or the output viewer, listed in the Keyboard Shortcuts editor but not rebound. */
export type Documented = {
  readonly keys: readonly string[];
  readonly mode: "edit" | "output";
  readonly label: string;
};

/** The page a key acts on. */
export type KeyPage = "home" | "notebook";

const pageMac = typeof navigator !== "undefined" && isMac(navigator.userAgent);

/** The two files' rules, as keybindings.rules and keybindings.changed carry them. */
export const keyFiles = shallowRef<KeybindingFiles>({ user: [], workspace: [] });
/** The page the keys are read for: useShortcuts sets it when a page mounts. */
export const keyPage = shallowRef<KeyPage>("notebook");

/** Every binding in effect, the files' rules applied over the defaults, and the rules that could not be read. */
export const resolvedKeys = computed(() => resolveKeybindings(keyFiles.value, pageMac));
/** The bindings that act somewhere on each page: a binding a later one shadows everywhere shows in no menu. */
const liveKeys = computed(() => ({
  home: liveKeybindings(resolvedKeys.value.entries, "home"),
  notebook: liveKeybindings(resolvedKeys.value.entries, "notebook"),
}));

/** The bindings in effect (the keyboard's table). */
export const keyTable = (): readonly Keybinding[] => resolvedKeys.value.entries;

export const documented: readonly Documented[] = [
  {
    keys: ["ArrowUp"],
    mode: "edit",
    label: "Focus Previous Cell Editor",
  },
  {
    keys: ["ArrowDown"],
    mode: "edit",
    label: "Focus Next Cell Editor",
  },
  { keys: ["Mod+/"], mode: "edit", label: "Toggle Line Comment" },
  { keys: ["Mod+D"], mode: "edit", label: "Add Selection to Next Find Match" },
  { keys: ["Mod+[", "Mod+]"], mode: "edit", label: "Outdent or Indent Line" },
  {
    keys: ["Tab", "Shift+Tab"],
    mode: "edit",
    label: "Indent or Outdent",
  },
  { keys: ["Tab", "Enter"], mode: "edit", label: "Accept Suggestion" },
  { keys: ["Alt+ArrowUp", "Alt+ArrowDown"], mode: "edit", label: "Move Line Up or Down" },
  { keys: ["Mod+F"], mode: "edit", label: "Find in Cell" },
  { keys: ["Mod+Z"], mode: "edit", label: "Undo" },
  { keys: ["Ctrl+Space"], mode: "edit", label: "Trigger Suggest" },
  { keys: ["Mod+Shift+Space"], mode: "edit", label: "Trigger Parameter Hints" },
  { keys: ["F12"], mode: "edit", label: "Go to Definition" },
  { keys: ["F2"], mode: "edit", label: "Rename Symbol" },
  {
    keys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    mode: "output",
    label: "Output: Move in Tree",
  },
  { keys: ["Mod+C"], mode: "output", label: "Output: Copy Value" },
  { keys: ["Alt+Mod+C"], mode: "output", label: "Output: Copy Path" },
];

/** Keys in plain words, as every menu, tooltip, the palette, the Shortcuts view and the bars print them (never a glyph such as ⌘ ⇧ ⌥ ↩): "Cmd B", "Shift Enter", "Alt Z", "Ctrl Space"; a chord's two keys stay
 * apart ("D D"). `mac` picks Cmd or Ctrl for Mod. */
export function keyWords(keys: string, mac: boolean): string {
  const words: Readonly<Record<string, string>> = {
    Mod: mac ? "Cmd" : "Ctrl",
    Escape: "Esc",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
  };
  return keys.replace(/[A-Za-z]+/gu, (part) => words[part] ?? part).replace(/\+/gu, " ");
}

/** Every key bound to `command` with exactly `args` that acts on the current page, in the table's order and once each
 * (the palette's one row for a command with several keys, M and T M). */
export function allKeysFor(command: string, args?: Args): readonly string[] {
  const live = liveKeys.value[keyPage.value].filter(
    (entry) => entry.command === command && sameArgs(entry.args, args),
  );
  return [...new Set(live.map((entry) => entry.key))];
}

/** The first keys bound to `command` with exactly `args` (a menu's or the palette's shortcut column), if any. */
export function keysFor(command: string, args?: Args): string | undefined {
  return allKeysFor(command, args)[0];
}

/** The first keys bound to `command` in words, for a tooltip, a menu or a hint; undefined when none is bound. Read in a
 * template or a computed, it follows every change of the bindings. */
export function keysShown(command: string, mac: boolean, args?: Args): string | undefined {
  const keys = keysFor(command, args);
  return keys === undefined ? undefined : keyWords(keys, mac);
}
