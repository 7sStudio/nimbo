// The keybindings of 03-api §4.11 and 07-file-format §6 as the daemon holds them: the user's and the workspace's
// keybindings.json, read, watched and applied over core's defaults as VS Code applies its files; keybindings.set and
// reset change a file rule by rule (comments kept), and every change of either file's rules (a command, the page's
// JSON view, a hand edit) emits keybindings.changed on the workspace stream with both files' rules, which the pages
// apply at once.
import type { KeybindingFiles, KeybindingTarget } from "@jsnb/core";
import { keybindingEdit, keybindingResetIndices, resolveKeybindings } from "@jsnb/core";

import type { EventBus } from "../../events/bus.js";
import { workspaceStream } from "../../events/bus.js";
import type { Log } from "../../events/log.js";
import { writeKeybindingsEdit } from "../../files/settings/keybindingsFile.js";
import { readSettingsText, writeSettingsText } from "../../files/settings/settingsFile.js";
import { watchSettingsFiles } from "../../files/settings/watch.js";
import type { Filter, KeybindingList, Scope, State, Target } from "./keybindingsRead.js";
import {
  canonicalKeys,
  listOf,
  load,
  mac,
  rulesOf,
  textProblems,
  whenOf,
} from "./keybindingsRead.js";

import type { KeybindingFilePaths } from "./keybindingsRead.js";

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

/** Both files read now and again whenever either changes (one reading at a time), keybindings.changed emitted when
 * their rules differ. */
async function followed(files: KeybindingFilePaths, bus: EventBus, log: Log) {
  let state = await load(files, log);
  let chain: Promise<void> = Promise.resolve();
  const reload = (): Promise<void> => {
    const task = async (): Promise<void> => {
      const next = await load(files, log);
      const changed = JSON.stringify(rulesOf(next)) !== JSON.stringify(rulesOf(state));
      state = next;
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
  return { state: () => state, reload, stop };
}

/** Loads both files and starts watching them; `bus` gets keybindings.changed. */
export async function openKeybindings(
  files: KeybindingFilePaths,
  bus: EventBus,
  log: Log,
): Promise<KeybindingsService> {
  const { state, reload, stop } = await followed(files, bus, log);
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
