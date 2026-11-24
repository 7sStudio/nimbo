// The keybindings files as the daemon reads them (03-api §4.11): both files' rules, the bindings in effect with their
// conflicts for keybindings.list, and the checks of what keybindings.set and the page's JSON view are given.
import type { KeybindingFiles, KeybindingSource } from "@jsnb/core";
import {
  InvalidParams,
  keybindingConflicts,
  keysText,
  parseKeys,
  parseWhen,
  resolveKeybindings,
  sameArgs,
} from "@jsnb/core";

import type { Log } from "../../events/log.js";
import type { KeybindingsFileRead } from "../../files/settings/keybindingsFile.js";
import { parseKeybindings, readKeybindingsFile } from "../../files/settings/keybindingsFile.js";

export type Scope = "user" | "workspace";
export type KeybindingFilePaths = { readonly user: string; readonly workspace: string };

type Listed = {
  readonly key: string;
  readonly command: string;
  readonly when: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly source: KeybindingSource;
  readonly conflicts: string[];
};
export type KeybindingList = {
  readonly keybindings: Listed[];
  readonly problems: { readonly file: Scope; readonly index: number; readonly message: string }[];
};

export type Filter = {
  readonly command?: string | undefined;
  readonly key?: string | undefined;
  readonly source?: KeybindingSource | undefined;
};
export type Target = {
  readonly command: string;
  readonly args?: Record<string, unknown> | undefined;
  readonly when?: string | undefined;
};

/** The daemon's platform names Mod in the files' keys: cmd on macOS, ctrl elsewhere (the page is on the same machine). */
export const mac = process.platform === "darwin";

export type State = { readonly user: KeybindingsFileRead; readonly workspace: KeybindingsFileRead };

export const rulesOf = (state: State): KeybindingFiles => ({
  user: state.user.rules.map((each) => each.rule),
  workspace: state.workspace.rules.map((each) => each.rule),
});

export function listOf(state: State, filter: Filter): KeybindingList {
  const { entries, problems } = resolveKeybindings(rulesOf(state), mac);
  const conflicts = keybindingConflicts(entries);
  const key = filter.key === undefined ? undefined : (parseKeys(filter.key, mac) ?? filter.key);
  const keybindings = entries.flatMap((entry, index): Listed[] => {
    if (filter.command !== undefined && entry.command !== filter.command) return [];
    if (key !== undefined && entry.key !== key && !entry.key.startsWith(`${key} `)) return [];
    if (filter.source !== undefined && entry.source !== filter.source) return [];
    return [
      {
        key: keysText(entry.key, mac),
        command: entry.command,
        when: entry.when,
        ...(entry.args === undefined ? {} : { args: entry.args }),
        source: entry.source,
        conflicts: [...new Set((conflicts[index] ?? []).map((each) => each.command))],
      },
    ];
  });
  // a rule core cannot read is reported by its index among the rules the schema accepted; name the file's index
  const fileProblems = (["user", "workspace"] as const).flatMap((file) =>
    state[file].problems.map((each) => ({ file, ...each })),
  );
  const ruleProblems = problems.map((each) => ({
    ...each,
    index: state[each.file].rules[each.index]?.index ?? each.index,
  }));
  return { keybindings, problems: [...fileProblems, ...ruleProblems] };
}

const invalid = (path: string, message: string) =>
  new InvalidParams({ issues: [{ path: [path], message }] });

/** The canonical keys of `keys`, InvalidParams naming the first that is not keys. */
export function canonicalKeys(keys: readonly string[]): string[] {
  // an empty word is no key: `--keys ''` on the command line unbinds
  return keys
    .filter((text) => text.trim() !== "")
    .map((text) => {
      const key = parseKeys(text, mac);
      if (key === undefined)
        throw invalid(
          "keys",
          `"${text}" is not a key (write cmd+shift+r, alt+up, or a chord: cmd+k cmd+r)`,
        );
      return key;
    });
}

/** The target's when clause: the one given (checked), else the one the command's bindings have now, else none. */
export function whenOf(state: State, target: Target): string {
  if (target.when !== undefined) {
    const read = parseWhen(target.when);
    if ("problem" in read) throw invalid("when", read.problem);
    return read.when.text;
  }
  const { entries } = resolveKeybindings(rulesOf(state), mac);
  const whens = new Set(
    entries
      .filter((each) => each.command === target.command && sameArgs(each.args, target.args))
      .map((each) => each.when),
  );
  if (whens.size > 1)
    throw invalid(
      "when",
      `${target.command} is bound under ${[...whens].map((each) => `"${each}"`).join(" and ")}: name one`,
    );
  return [...whens][0] ?? "";
}

/** InvalidParams naming what a hand-written keybindings text gets wrong (a parse problem, a rule core cannot read). */
export function textProblems(text: string): InvalidParams | undefined {
  const read = parseKeybindings(text);
  const { problems } = resolveKeybindings(
    { user: read.rules.map((each) => each.rule), workspace: [] },
    mac,
  );
  const issues = [
    ...read.problems.map((each) => ({ path: ["text"], message: each.message })),
    ...problems.map((each) => ({
      path: ["text"],
      message: `rule ${String((read.rules[each.index]?.index ?? each.index) + 1)}: ${each.message}`,
    })),
  ];
  return issues.length === 0 ? undefined : new InvalidParams({ issues });
}

export async function load(files: KeybindingFilePaths, log: Log): Promise<State> {
  const [user, workspace] = await Promise.all([
    readKeybindingsFile(files.user),
    readKeybindingsFile(files.workspace),
  ]);
  for (const [file, read] of [
    [files.user, user],
    [files.workspace, workspace],
  ] as const)
    for (const problem of read.problems)
      log.warn({ file, problem }, "keybindings file not read whole");
  return { user, workspace };
}
