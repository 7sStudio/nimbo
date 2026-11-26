// resolveSettings: defaults < user file < workspace file, plus per-key validation and writability.
import { z } from "zod";

import { InvalidParams, NotAvailable } from "../errors/api.js";
import { resolvedValueSchema } from "../model/settings.js";
import type { SettingsKey } from "./schema.js";
import { isSettingsKey, settingsKeys, settingsMeta, settingsShape } from "./schema.js";

/** The folder of a workspace that holds its settings file, as `.vscode/` holds VS Code's: `<workspace>/.jsnb/settings.json`.
 * One name for the daemon and the CLI. */
export const workspaceSettingsFolder = ".jsnb";
/** The settings file's name, in the user's config folder and in the workspace's settings folder. */
export const settingsFileName = "settings.json";
/** The keybindings file's name, beside the settings file in both folders, as VS Code's keybindings.json. */
export const keybindingsFileName = "keybindings.json";

export type SettingsSource = "default" | "user" | "workspace";
export type SettingsFile = "user" | "workspace";

/** A key's effective value, the file it comes from, and what each file sets it to (absent when that file does not set
 * it, or sets a value the schema refuses): the Settings editor's User and Workspace tabs show their own file's value,
 * as VS Code's do. */
export type ResolvedValue = {
  readonly value: unknown;
  readonly source: SettingsSource;
  readonly user?: unknown;
  readonly workspace?: unknown;
};

export type SettingsWarning = {
  readonly key: string;
  readonly file: SettingsFile;
  readonly message: string;
};

export type ResolvedSettings = {
  readonly values: Readonly<Record<SettingsKey, ResolvedValue>>;
  readonly warnings: readonly SettingsWarning[];
  /** Keys no schema knows, kept as they were with the file they came from. */
  readonly unknown: Readonly<
    Record<string, { readonly value: unknown; readonly file: SettingsFile }>
  >;
};

type Files = {
  readonly user: Readonly<Record<string, unknown>>;
  readonly workspace: Readonly<Record<string, unknown>>;
};

const Values = z.record(z.enum(settingsKeys), resolvedValueSchema);

/** The effective value of every key with its source; invalid file values are skipped with a warning. */
export function resolveSettings(files: Files): ResolvedSettings {
  const warnings: SettingsWarning[] = [];
  const unknown: Record<string, { value: unknown; file: SettingsFile }> = {};
  const layers: readonly (readonly [SettingsFile, Readonly<Record<string, unknown>>])[] = [
    ["user", files.user],
    ["workspace", files.workspace],
  ];
  const entries = settingsKeys.map((key): [SettingsKey, ResolvedValue] => {
    let resolved: ResolvedValue = { value: settingsShape[key].parse(undefined), source: "default" };
    const perFile: { user?: unknown; workspace?: unknown } = {};
    for (const [file, values] of layers) {
      if (!(key in values)) continue;
      const checked = settingsShape[key].safeParse(values[key]);
      if (checked.success) {
        resolved = { value: checked.data, source: file };
        perFile[file] = checked.data;
      } else
        warnings.push({
          key,
          file,
          message: `${key} in the ${file} settings is invalid: ${firstIssue(checked.error)}; the default applies`,
        });
    }
    return [key, { ...resolved, ...perFile }];
  });
  for (const [file, values] of layers) {
    for (const key of Object.keys(values).filter((k) => !isSettingsKey(k))) {
      unknown[key] = { value: values[key], file };
      warnings.push({ key, file, message: `unknown key ${key} in the ${file} settings kept` });
    }
  }
  return { values: Values.parse(Object.fromEntries(entries)), warnings, unknown };
}

const firstIssue = (error: z.ZodError): string => error.issues[0]?.message ?? "invalid value";

export type ValidatedSetting =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: InvalidParams };

/** Validates one value against its key's schema, as `settings.set` does before writing. */
export function validateSetting(key: SettingsKey, value: unknown): ValidatedSetting {
  const checked = settingsShape[key].safeParse(value);
  if (checked.success) return { ok: true, value: checked.data };
  const issues = checked.error.issues.map((issue) => ({
    path: [key, ...issue.path],
    message: issue.message,
  }));
  return { ok: false, error: new InvalidParams({ issues }) };
}

export type WritableSetting =
  { readonly ok: true } | { readonly ok: false; readonly error: NotAvailable };

/** A planned key is accepted in files but refused by `settings.set`. */
export function assertWritable(key: SettingsKey): WritableSetting {
  return settingsMeta[key].status === "planned"
    ? { ok: false, error: new NotAvailable({ feature: key, planned: true }) }
    : { ok: true };
}
