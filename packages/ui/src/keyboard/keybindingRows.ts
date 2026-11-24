// The Keyboard Shortcuts editor's rows, as VS Code's: one row per binding in effect (a command with two
// keys has two rows), each with its when clause, the file it comes from and the commands it conflicts with; then every
// command the palette offers that no key is bound to, so it can be bound; then the keys CodeMirror and the output viewer
// handle, listed but not rebound. A search matches the title, the command id, the when clause and the keys as shown
// or as written; `@source:user` (default, workspace) and `@command:id` narrow as VS Code's do, and a quoted key
// ("cmd+k") from Record Keys matches the bindings of those keys only.
import type { Keybinding, KeybindingFiles } from "@jsnb/core";
import { defaultKeybindings, keybindingConflicts, keysText, parseKeys, sameArgs } from "@jsnb/core";

import type { Args } from "../commands/command.js";
import type { Documented } from "./keymap.js";
import { keyWords } from "./keymap.js";

type KeySource = "default" | "user" | "workspace" | "builtin";

export type KeyRow = {
  /** Unique among the rows. */
  readonly id: string;
  /** What a change is about; null for a key the editor or the output viewer handles. */
  readonly target: {
    readonly command: string;
    readonly args?: Args;
    readonly when: string;
  } | null;
  readonly title: string;
  /** The command id, as keybindings.json names it ("" for a built-in key). */
  readonly command: string;
  /** The binding's keys (canonical); none for an unbound command, several for a built-in row. */
  readonly keys: readonly string[];
  readonly when: string;
  /** Where it comes from; null for an unbound command no file touched. */
  readonly source: KeySource | null;
  /** The titles of the commands bound to the same key where this one is. */
  readonly conflicts: readonly string[];
};

const builtinWhen: Readonly<Record<Documented["mode"], string>> = {
  edit: "editMode",
  output: "outputFocus",
};

type Catalogue = readonly { readonly command: string; readonly args?: Args }[];
type TitleOf = (command: string, args?: Args) => string;

/** What the rows are made of: the bindings in effect, the files' rules, the commands that can be bound (the palette's),
 * the built-in keys, and the words a command is shown with. */
export type KeyRowsInput = {
  readonly entries: readonly Keybinding[];
  readonly files: KeybindingFiles;
  readonly catalogue: Catalogue;
  readonly documented: readonly Documented[];
  readonly titleOf: TitleOf;
};

const targetOf = (command: string, args: Args | undefined, when: string) => ({
  command,
  ...(args === undefined ? {} : { args }),
  when,
});

/** One row per binding, in the defaults' order (a changed default stays where it was), the files' own after them. */
function boundRows({ entries, titleOf }: KeyRowsInput): readonly KeyRow[] {
  const conflicts = keybindingConflicts(entries);
  // a changed or moved default stays where the default is, a file's own command after every default
  const order = (entry: Keybinding): number => {
    const at = defaultKeybindings.findIndex(
      (each) => each.command === entry.command && sameArgs(each.args, entry.args),
    );
    return at === -1 ? defaultKeybindings.length + entries.indexOf(entry) : at;
  };
  return entries
    .map((entry, index) => ({ entry, index }))
    .toSorted((a, b) => order(a.entry) - order(b.entry) || a.index - b.index)
    .map(({ entry, index }): KeyRow => ({
      id: `b${String(index)}`,
      target: targetOf(entry.command, entry.args, entry.when),
      title: titleOf(entry.command, entry.args),
      command: entry.command,
      keys: [entry.key],
      when: entry.when,
      source: entry.source,
      conflicts: [
        ...new Set((conflicts[index] ?? []).map((each) => titleOf(each.command, each.args))),
      ],
    }));
}

/** The file that last said something about `command` (a removed default shows where it was removed), else null. */
function touchedBy(files: KeybindingFiles, command: string): KeySource | null {
  const named = (rule: { readonly command: string }) => rule.command.replace(/^-/u, "") === command;
  if (files.workspace.some(named)) return "workspace";
  return files.user.some(named) ? "user" : null;
}

/** A row for each command of the catalogue or the defaults that no key is bound to now, by title. */
function unboundRows({ entries, files, catalogue, titleOf }: KeyRowsInput): readonly KeyRow[] {
  const seen = new Set<string>();
  return [...catalogue, ...defaultKeybindings]
    .flatMap((each): KeyRow[] => {
      const id = `${each.command}${each.args === undefined ? "" : JSON.stringify(each.args)}`;
      const same = (entry: Omit<Keybinding, "source">) =>
        entry.command === each.command && sameArgs(entry.args, each.args);
      if (seen.has(id) || entries.some(same)) return [];
      seen.add(id);
      // a default whose keys were all removed keeps its when clause, so a new key acts where the old one did
      const when = defaultKeybindings.find(same)?.when ?? "";
      return [
        {
          id: `u${id}`,
          target: targetOf(each.command, each.args, when),
          title: titleOf(each.command, each.args),
          command: each.command,
          keys: [],
          when,
          source: touchedBy(files, each.command),
          conflicts: [],
        },
      ];
    })
    .toSorted((a, b) => a.title.localeCompare(b.title));
}

/** Every row, by command title as VS Code lists them; `precedence` instead keeps the bindings in the order they apply
 * (the defaults', then the user's file, then the workspace's), the unbound commands and the built-in keys after. */
export function keyRows(input: KeyRowsInput, precedence = false): readonly KeyRow[] {
  const builtin = input.documented.map((row, index): KeyRow => ({
    id: `d${String(index)}`,
    target: null,
    title: row.label,
    command: "",
    keys: row.keys,
    when: builtinWhen[row.mode],
    source: "builtin",
    conflicts: [],
  }));
  const rows = [...boundRows(input), ...unboundRows(input), ...builtin];
  return precedence ? rows : rows.toSorted((a, b) => a.title.localeCompare(b.title));
}

/** What the search field holds: the words, the `@source:` and `@command:` filters, a quoted key from Record Keys. */
function queryOf(text: string): {
  readonly words: string;
  readonly source?: string;
  readonly command?: string;
  readonly keys?: string;
} {
  let words = text;
  const take = (pattern: RegExp): string | undefined => {
    const match = pattern.exec(words);
    if (match === null) return undefined;
    words = words.replace(match[0], " ");
    return match[1];
  };
  const source = take(/@source:(\S+)/u);
  const command = take(/@command:(\S+)/u);
  const keys = take(/"([^"]+)"/u);
  return {
    words: words.trim().toLowerCase(),
    ...(source === undefined ? {} : { source: source.toLowerCase() }),
    ...(command === undefined ? {} : { command }),
    ...(keys === undefined ? {} : { keys }),
  };
}

/** `@source:` words: VS Code's `system` for the defaults and the built-in keys (`default` too), `user`, `workspace`. */
const sourceWords: Readonly<Record<KeySource, readonly string[]>> = {
  default: ["system", "default"],
  user: ["user"],
  workspace: ["workspace"],
  builtin: ["system"],
};

/** True when `row` has the recorded keys, or a chord that starts with them; null keys match nothing. */
const hasKeys = (row: KeyRow, keys: string | null): boolean =>
  keys !== null && row.keys.some((each) => each === keys || each.startsWith(`${keys} `));

/** True when the row passes the query's `@source:` and `@command:` filters. */
const passes = (row: KeyRow, query: ReturnType<typeof queryOf>): boolean =>
  (query.source === undefined ||
    (row.source !== null && sourceWords[row.source].includes(query.source))) &&
  (query.command === undefined || row.command === query.command);

/** True when every word is in the row's title, command id, when clause or keys (shown, written, canonical). */
function hasWords(row: KeyRow, words: string, mac: boolean): boolean {
  if (words === "") return true;
  const haystack = [
    row.title,
    row.command,
    row.when,
    ...row.keys,
    ...row.keys.map((keys) => keyWords(keys, mac)),
    ...row.keys.map((keys) => keysText(keys, mac)),
  ]
    .join("\n")
    .toLowerCase();
  return words.split(/\s+/u).every((word) => haystack.includes(word));
}

/** The rows `text` matches: its filters, its quoted keys (a chord's first key matches the chord), its words. */
export function filterRows(rows: readonly KeyRow[], text: string, mac: boolean): readonly KeyRow[] {
  const query = queryOf(text);
  const recorded = query.keys === undefined ? undefined : (parseKeys(query.keys, mac) ?? null);
  return rows.filter(
    (row) =>
      passes(row, query) &&
      (recorded === undefined || hasKeys(row, recorded)) &&
      hasWords(row, query.words, mac),
  );
}
