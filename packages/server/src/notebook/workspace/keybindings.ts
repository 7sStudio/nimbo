// The keybindings as the daemon holds them: the user's and the workspace's
// keybindings.json, read, watched and applied over core's defaults as VS Code applies its files; keybindings.list
// answers the bindings in effect with their conflicts; keybindings.set and reset change a file rule by rule (comments
// kept), what they and the page's JSON view are given checked first; and every change of either file's rules (a
// command, the page's JSON view, a hand edit) emits keybindings.changed on the workspace stream with both files'
// rules, which the pages apply at once.
import type { KeybindingFiles, KeybindingSource, KeybindingTarget } from "@jsnb/core";
import {
  InvalidParams,
  keybindingConflicts,
  keybindingEdit,
  keybindingResetIndices,
  keysText,
  parseKeys,
  parseWhen,
  resolveKeybindings,
  sameArgs,
} from "@jsnb/core";

import type { EventBus } from "../../events/bus.js";
import { workspaceStream } from "../../events/bus.js";
import type { Log } from "../../events/log.js";
import type { KeybindingsFileRead } from "../../files/settings/keybindingsFile.js";
import {
  parseKeybindings,
  readKeybindingsFile,
  writeKeybindingsEdit,
} from "../../files/settings/keybindingsFile.js";
import { readSettingsText, writeSettingsText } from "../../files/settings/settingsFile.js";
import { watchSettingsFiles } from "../../files/settings/watch.js";

type Scope = "user" | "workspace";
type KeybindingFilePaths = { readonly user: string; readonly workspace: string };

type Listed = {
  readonly key: string;
  readonly command: string;
  readonly when: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly source: KeybindingSource;
  readonly conflicts: string[];
};
type KeybindingList = {
  readonly keybindings: Listed[];
  readonly problems: { readonly file: Scope; readonly index: number; readonly message: string }[];
};

type Filter = {
  readonly command?: string | undefined;
  readonly key?: string | undefined;
  readonly source?: KeybindingSource | undefined;
};
type Target = {
  readonly command: string;
  readonly args?: Record<string, unknown> | undefined;
  readonly when?: string | undefined;
};

/** The daemon's platform names Mod in the files' keys: cmd on macOS, ctrl elsewhere (the page is on the same machine). */
const mac = process.platform === "darwin";

type State = { readonly user: KeybindingsFileRead; readonly workspace: KeybindingsFileRead };

const rulesOf = (state: State): KeybindingFiles => ({
  user: state.user.rules.map((each) => each.rule),
  workspace: state.workspace.rules.map((each) => each.rule),
});

function listOf(state: State, filter: Filter): KeybindingList {
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
function canonicalKeys(keys: readonly string[]): string[] {
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
function whenOf(state: State, target: Target): string {
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
function textProblems(text: string): InvalidParams | undefined {
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

async function load(files: KeybindingFilePaths, log: Log): Promise<State> {
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

export type KeybindingsService = {
  /** Both files' rules, as the page applies them. */
  readonly rules: () => KeybindingFiles;
  /** The bindings in effect, filtered. */
  readonly list: (filter: Filter) => KeybindingList;
  /** Gives `target` exactly `keys` in the file of `scope`. */
  readonly set: (target: Target, keys: readonly string[], scope: Scope) => Promise<KeybindingList>;
  /** Removes what the file of `scope` (or both) says about `target`. */
  readonly reset: (target: Target, scope: Scope | undefined) => Promise<KeybindingList>;
  readonly file: (scope: Scope) => Promise<{ readonly path: string; readonly text: string }>;
  readonly writeFile: (scope: Scope, text: string) => Promise<void>;
  readonly close: () => void;
};

/** Gives `target` exactly `keys` in the file at `path`, over the layers below it in `state`. */
async function setKeys(
  state: State,
  write: { readonly path: string; readonly scope: Scope },
  target: Target,
  keys: readonly string[],
): Promise<void> {
  const wanted = canonicalKeys(keys);
  const exact: KeybindingTarget = {
    command: target.command,
    when: whenOf(state, target),
    ...(target.args === undefined ? {} : { args: target.args }),
  };
  // the layers under the file written: the defaults, and the user's file under the workspace's
  const below = resolveKeybindings(
    { user: write.scope === "workspace" ? rulesOf(state).user : [], workspace: [] },
    mac,
  ).entries;
  await writeKeybindingsEdit(write.path, (read) => {
    const rules = read.rules.map((each) => each.rule);
    const edit = keybindingEdit({ rules, below, target: exact, keys: wanted, mac });
    return { remove: edit.remove.map((index) => read.rules[index]?.index ?? -1), add: edit.add };
  });
}

/** Removes what the files at `paths` say about `target`; a file that says nothing about it is left as it is. */
async function resetKeys(
  state: State,
  paths: readonly { readonly path: string; readonly scope: Scope }[],
  target: Target,
): Promise<void> {
  const scoped = {
    command: target.command,
    ...(target.when === undefined ? {} : { when: whenOf(state, target) }),
    ...(target.args === undefined ? {} : { args: target.args }),
  };
  for (const { path, scope } of paths) {
    const own = state[scope].rules.map((rule) => rule.rule);
    if (keybindingResetIndices(own, scoped).length === 0) continue;
    await writeKeybindingsEdit(path, (read) => ({
      remove: keybindingResetIndices(
        read.rules.map((rule) => rule.rule),
        scoped,
      ).map((index) => read.rules[index]?.index ?? -1),
      add: [],
    }));
  }
}

/** Loads both files and starts watching them; `bus` gets keybindings.changed. */
export async function openKeybindings(
  files: KeybindingFilePaths,
  bus: EventBus,
  log: Log,
): Promise<KeybindingsService> {
  // both files read now and again whenever either changes (one reading at a time), keybindings.changed emitted when
  // their rules differ
  let current = await load(files, log);
  const state = (): State => current;
  let chain: Promise<void> = Promise.resolve();
  const reload = (): Promise<void> => {
    const task = async (): Promise<void> => {
      const next = await load(files, log);
      const changed = JSON.stringify(rulesOf(next)) !== JSON.stringify(rulesOf(current));
      current = next;
      if (changed) bus.emit(workspaceStream, "keybindings.changed", rulesOf(next));
    };
    chain = chain.then(task, task);
    return chain;
  };
  const stop = watchSettingsFiles([files.user, files.workspace], () => {
    reload().catch((error: unknown) => {
      log.error({ err: error }, "the keybindings files could not be read again");
    });
  });
  const at = (scope: Scope) => ({ path: files[scope], scope });
  const after = async (target: Target): Promise<KeybindingList> => {
    await reload();
    return listOf(state(), { command: target.command });
  };
  return {
    rules: () => rulesOf(state()),
    list: (filter: Filter) => listOf(state(), filter),
    set: async (target, keys, scope) => {
      await setKeys(state(), at(scope), target, keys);
      return after(target);
    },
    reset: async (target, scope) => {
      await resetKeys(
        state(),
        scope === undefined ? [at("user"), at("workspace")] : [at(scope)],
        target,
      );
      return after(target);
    },
    file: async (scope) => ({ path: files[scope], text: await readSettingsText(files[scope]) }),
    writeFile: async (scope, text) => {
      const problem = textProblems(text);
      if (problem) throw problem;
      await writeSettingsText(files[scope], text);
      await reload();
    },
    close: stop,
  };
}
