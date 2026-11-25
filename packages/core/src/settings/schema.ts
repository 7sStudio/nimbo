// The settings schema of 03-api §4.10 and 07-file-format §6: every v1 key with its default, title and status.
// Each key's title, description and status are in meta.ts.
import { z } from "zod";

import type { SettingsKey } from "./keys.js";
import { settingsKeys } from "./keys.js";
import { settingsMeta } from "./meta.js";

export type { SettingMeta, SettingStatus, SettingsKey } from "./keys.js";
export { settingsKeys, settingsMeta };

const describe = <T extends z.ZodType>(key: SettingsKey, schema: T): T =>
  schema.describe(settingsMeta[key].description);
const int = (key: SettingsKey, fallback: number) =>
  describe(key, z.number().int().positive().default(fallback));
const flag = (key: SettingsKey, fallback: boolean) => describe(key, z.boolean().default(fallback));

export const settingsShape = {
  "bridge.rpcTimeoutMs": int("bridge.rpcTimeoutMs", 60_000),
  "bridge.maxBytesPerValue": int("bridge.maxBytesPerValue", 5_242_880),
  "execution.autoRunDependents": flag("execution.autoRunDependents", false),
  "files.autoSave": describe(
    "files.autoSave",
    z.enum(["afterDelay", "onFocusChange", "interval", "off"]).default("afterDelay"),
  ),
  "files.autoSaveDelay": int("files.autoSaveDelay", 1000),
  "files.autoSaveMaxWait": int("files.autoSaveMaxWait", 10_000),
  "files.autoSaveInterval": int("files.autoSaveInterval", 120_000),
  "files.mergeExternalChanges": flag("files.mergeExternalChanges", true),
  "kernel.nodePath": describe("kernel.nodePath", z.string().nullable().default(null)),
  "packages.manager": describe(
    "packages.manager",
    z.enum(["auto", "pnpm", "npm", "yarn", "bun"]).default("auto"),
  ),
  "realm.headless": flag("realm.headless", false),
  "realm.headlessBrowser": describe("realm.headlessBrowser", z.string().nullable().default(null)),
  "realm.headlessIdleMs": int("realm.headlessIdleMs", 600_000),
  "realm.headlessSandbox": flag("realm.headlessSandbox", true),
  "outputs.maxValueBytes": int("outputs.maxValueBytes", 262_144),
  "outputs.maxStreamBytes": int("outputs.maxStreamBytes", 1_048_576),
  "outputs.maxHeightPx": int("outputs.maxHeightPx", 400),
  "outputs.defaultView": describe(
    "outputs.defaultView",
    z.enum(["auto", "tree", "grid", "raw"]).default("auto"),
  ),
  "outputs.expandDepth": describe("outputs.expandDepth", z.number().int().nonnegative().default(2)),
  "outputs.retainFullValue": flag("outputs.retainFullValue", true),
  "outputs.retainMaxBytes": int("outputs.retainMaxBytes", 67_108_864),
  "outputs.save": describe("outputs.save", z.enum(["auto", "always", "never"]).default("auto")),
  "query.timeoutMs": int("query.timeoutMs", 5000),
  "query.sqlMaxRows": int("query.sqlMaxRows", 10_000),
  "cells.titleFromFirstLine": flag("cells.titleFromFirstLine", false),
  "outline.showAllCells": flag("outline.showAllCells", false),
  "editor.fontSize": int("editor.fontSize", 13),
  "editor.tabSize": int("editor.tabSize", 2),
  "editor.wordWrap": flag("editor.wordWrap", true),
  "editor.keymap": describe("editor.keymap", z.enum(["default", "vim"]).default("default")),
  "editor.intellisense": flag("editor.intellisense", true),
  "editor.diagnostics": flag("editor.diagnostics", true),
  "editor.lineValues": flag("editor.lineValues", true),
  "editor.syntaxTheme": describe(
    "editor.syntaxTheme",
    z
      .enum([
        "vscode",
        "github",
        "cursor",
        "jetbrains",
        "one",
        "catppuccin",
        "tokyo-night",
        "nimbo",
      ])
      .default("vscode"),
  ),
  "ui.theme": describe("ui.theme", z.enum(["system", "light", "dark"]).default("system")),
  "git.enabled": flag("git.enabled", true),
  "diffEditor.renderSideBySide": flag("diffEditor.renderSideBySide", true),
  "notebookDiff.showEntireNotebook": flag("notebookDiff.showEntireNotebook", false),
  "notebookDiff.rawMarkdown": flag("notebookDiff.rawMarkdown", false),
  "notebookDiff.contextCells": describe(
    "notebookDiff.contextCells",
    z.number().int().nonnegative().default(1),
  ),
  "notebookDiff.showMetadata": flag("notebookDiff.showMetadata", false),
  "notebookDiff.hideOutputs": flag("notebookDiff.hideOutputs", false),
  "secrets.allowLiveKeys": flag("secrets.allowLiveKeys", false),
};

/** One Zod object with every key; parsing `{}` gives the defaults. */
export const settingsSchema = z.object(settingsShape);
export type Settings = z.infer<typeof settingsSchema>;

/** The effective settings with no file at all. */
export function settingsDefaults(): Settings {
  return settingsSchema.parse({});
}

/** True when `key` is a v1 settings key. */
export function isSettingsKey(key: string): key is SettingsKey {
  return settingsKeys.some((known) => known === key);
}
