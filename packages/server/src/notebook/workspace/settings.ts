// The settings of 03-api §4.10 and 07-file-format §6 as the daemon holds them: defaults < user file < workspace file,
// each value with its source; settings.set writes a file through the JSONC edit API; both files are watched, and every
// change of an effective value (a set or a hand edit) emits settings.changed on the workspace stream.
import type { Settings, SettingsKey } from "@jsnb/core";
import {
  assertWritable,
  InvalidParams,
  isSettingsKey,
  resolveSettings,
  settingsKeys,
  settingsSchema,
  validateSetting,
} from "@jsnb/core";
import type { ResolvedSettings, ResolvedValue, SettingsFile } from "@jsnb/core";

import type { EventBus } from "../../events/bus.js";
import { workspaceStream } from "../../events/bus.js";
import {
  parseSettings,
  readSettingsFile,
  readSettingsText,
  writeSettingsKey,
  writeSettingsText,
} from "../../files/settings/settingsFile.js";
import { watchSettingsFiles } from "../../files/settings/watch.js";
import type { Log } from "../../events/log.js";

export type SettingsService = {
  /** Every key's effective value and source, or one key's. */
  readonly get: (key?: SettingsKey) => Readonly<Record<string, ResolvedValue>>;
  /** Validates, writes the file of `scope`, applies; returns the value written. No value removes the key there. */
  readonly set: (key: SettingsKey, value: unknown, scope: SettingsFile) => Promise<unknown>;
  /** The effective values, typed. */
  readonly current: () => Settings;
  /** The file of `scope` as text (Settings (JSON)), "" when missing. */
  readonly file: (scope: SettingsFile) => Promise<{ readonly path: string; readonly text: string }>;
  /** Replaces the file of `scope` with `text` once it parses and every known key's value is valid; applies it. */
  readonly writeFile: (scope: SettingsFile, text: string) => Promise<void>;
  /** Stops watching the files. */
  readonly close: () => void;
};

export type SettingsFiles = { readonly user: string; readonly workspace: string };

type State = { resolved: ResolvedSettings; settings: Settings };

async function load(files: SettingsFiles, log: Log): Promise<State> {
  const [user, workspace] = await Promise.all([
    readSettingsFile(files.user),
    readSettingsFile(files.workspace),
  ]);
  for (const [file, read] of [
    [files.user, user],
    [files.workspace, workspace],
  ] as const) {
    for (const problem of read.problems)
      log.warn({ file, problem }, "settings file not read whole");
  }
  const resolved = resolveSettings({ user: user.values, workspace: workspace.values });
  for (const warning of resolved.warnings) log.warn({ ...warning }, warning.message);
  const values = Object.fromEntries(settingsKeys.map((key) => [key, resolved.values[key].value]));
  return { resolved, settings: settingsSchema.parse(values) };
}

/** The same effective value and source, and the same value in each file (a user value a workspace value outranks still
 * changes what the User tab shows). */
const same = (a: ResolvedValue, b: ResolvedValue): boolean => {
  const text = (value: ResolvedValue) =>
    JSON.stringify([
      value.value,
      value.source,
      "user" in value ? [value.user] : [],
      "workspace" in value ? [value.workspace] : [],
    ]);
  return text(a) === text(b);
};

/** settings.changed for every key whose effective value, source or value in either file differs. */
function emitChanges(bus: EventBus, before: ResolvedSettings, after: ResolvedSettings): void {
  for (const key of settingsKeys) {
    const value = after.values[key];
    if (!same(before.values[key], value))
      bus.emit(workspaceStream, "settings.changed", { key, ...value });
  }
}

/** Validates `value` for `key`; NotAvailable for a planned key, InvalidParams for a value the schema refuses. */
function checked(key: SettingsKey, value: unknown): unknown {
  const writable = assertWritable(key);
  if (!writable.ok) throw writable.error;
  const valid = validateSetting(key, value);
  if (!valid.ok) throw valid.error;
  return valid.value;
}

/** InvalidParams naming what a hand-written settings text gets wrong: a parse problem, a known key's bad value. */
function textProblems(text: string): InvalidParams | undefined {
  const read = parseSettings(text);
  const issues = [
    ...read.problems.map((message) => ({ path: ["text"], message })),
    ...Object.entries(read.values).flatMap(([key, value]) => {
      if (!isSettingsKey(key)) return []; // unknown keys are kept and reported, as in a file edited by hand
      const valid = validateSetting(key, value);
      return valid.ok ? [] : valid.error.data.issues;
    }),
  ];
  return issues.length === 0 ? undefined : new InvalidParams({ issues });
}

/** Settings (JSON): a file read as text, and replaced whole once it checks, then applied by `reload`. */
function fileAccess(
  files: SettingsFiles,
  reload: () => Promise<void>,
): Pick<SettingsService, "file" | "writeFile"> {
  const pathOf = (scope: SettingsFile) => (scope === "user" ? files.user : files.workspace);
  return {
    file: async (scope) => ({ path: pathOf(scope), text: await readSettingsText(pathOf(scope)) }),
    writeFile: async (scope, text) => {
      const problem = textProblems(text);
      if (problem) throw problem;
      await writeSettingsText(pathOf(scope), text);
      await reload();
    },
  };
}

/** Loads both files and starts watching them; `bus` gets settings.changed. */
export async function openSettings(
  files: SettingsFiles,
  bus: EventBus,
  log: Log,
): Promise<SettingsService> {
  let state = await load(files, log);
  let chain: Promise<void> = Promise.resolve();
  /** Re-reads both files, one reload at a time, and emits each effective value that changed. */
  const reload = (): Promise<void> => {
    const task = async (): Promise<void> => {
      const next = await load(files, log);
      const before = state.resolved;
      state = next;
      emitChanges(bus, before, next.resolved);
    };
    chain = chain.then(task, task); // a failed reload (already reported) does not stop the next one
    return chain;
  };
  const stop = watchSettingsFiles([files.user, files.workspace], () => {
    reload().catch((error: unknown) => {
      log.error({ err: error }, "the settings files could not be read again");
    });
  });
  return {
    get: (key) => {
      const values = state.resolved.values;
      return key === undefined ? values : { [key]: values[key] };
    },
    set: async (key, value, scope) => {
      // no value: the key leaves that file (Reset Setting), and the next scope or the default applies
      const valid = value === undefined ? undefined : checked(key, value);
      await writeSettingsKey(scope === "user" ? files.user : files.workspace, key, valid);
      await reload();
      return valid;
    },
    current: () => state.settings,
    ...fileAccess(files, reload),
    close: stop,
  };
}
