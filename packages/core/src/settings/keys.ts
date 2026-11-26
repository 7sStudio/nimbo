// Every v1 settings key, and the shape of its title, description and status.
export type SettingStatus = "stable" | "planned";
export type SettingMeta = {
  readonly title: string;
  readonly description: string;
  readonly status: SettingStatus;
};

export const settingsKeys = [
  "bridge.rpcTimeoutMs",
  "bridge.maxBytesPerValue",
  "execution.autoRunDependents",
  "files.autoSave",
  "files.autoSaveDelay",
  "files.autoSaveMaxWait",
  "files.autoSaveInterval",
  "files.mergeExternalChanges",
  "kernel.nodePath",
  "packages.manager",
  "realm.headless",
  "realm.headlessBrowser",
  "realm.headlessIdleMs",
  "realm.headlessSandbox",
  "outputs.maxValueBytes",
  "outputs.maxStreamBytes",
  "outputs.maxHeightPx",
  "outputs.defaultView",
  "outputs.expandDepth",
  "outputs.retainFullValue",
  "outputs.retainMaxBytes",
  "outputs.save",
  "query.timeoutMs",
  "query.sqlMaxRows",
  "cells.titleFromFirstLine",
  "outline.showAllCells",
  "editor.fontSize",
  "editor.tabSize",
  "editor.wordWrap",
  "editor.keymap",
  "editor.intellisense",
  "editor.diagnostics",
  "editor.lineValues",
  "editor.syntaxTheme",
  "ui.theme",
  "git.enabled",
  "diffEditor.renderSideBySide",
  "notebookDiff.showEntireNotebook",
  "notebookDiff.rawMarkdown",
  "notebookDiff.contextCells",
  "notebookDiff.showMetadata",
  "notebookDiff.hideOutputs",
  "secrets.allowLiveKeys",
] as const;
export type SettingsKey = (typeof settingsKeys)[number];
