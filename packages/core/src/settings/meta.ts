// Each settings key's title, description and status: for the Settings page, the CLI and the JSON
// Schema, beside the schema of schema.ts.
import type { SettingMeta, SettingsKey } from "./keys.js";

const stable = (title: string, description: string): SettingMeta => ({
  title,
  description,
  status: "stable",
});
const planned = (title: string, description: string): SettingMeta => ({
  title,
  description,
  status: "planned",
});

/** Title, description and status per key, for the settings panel, the CLI and the JSON Schema. */
export const settingsMeta: Readonly<Record<SettingsKey, SettingMeta>> = {
  "bridge.rpcTimeoutMs": stable(
    "Bridge call timeout",
    "How long a client cell waits for a server function, in milliseconds.",
  ),
  "bridge.maxBytesPerValue": stable(
    "Bridge byte limit",
    "The largest Uint8Array or Buffer that crosses the bridge whole, in either direction.",
  ),
  "execution.autoRunDependents": stable(
    "Auto-run dependents",
    "After a cell runs well, run its stale dependents in order; cells marked manual and their dependents wait.",
  ),
  "files.autoSave": stable(
    "Auto save",
    "afterDelay saves once typing pauses, onFocusChange when the page loses focus, interval every few minutes, off only on Save.",
  ),
  "files.autoSaveDelay": stable(
    "Auto save delay",
    "afterDelay: the pause after the last change before a save, in milliseconds.",
  ),
  "files.autoSaveMaxWait": stable(
    "Auto save max wait",
    "afterDelay: the longest changes wait while editing goes on, in milliseconds.",
  ),
  "files.autoSaveInterval": stable(
    "Auto save interval",
    "interval: the time between saves, in milliseconds.",
  ),
  "files.mergeExternalChanges": stable(
    "Merge external changes",
    "Merge edits made to an open notebook's file outside nimbo (an editor, git) into the page; off shows Changed on disk at the next save.",
  ),
  "kernel.nodePath": stable(
    "Node path",
    "The Node binary that runs kernels; null means the Node that runs the daemon.",
  ),
  "packages.manager": stable(
    "Package manager",
    "auto detects from the lockfile, else pnpm, npm, yarn or bun.",
  ),
  "realm.headless": stable(
    "Headless client realm",
    "With no tab holding a notebook, run its client cells in a headless Chrome, Chromium or Edge of this machine, started when a client run or a snapshot needs it; a tab that opens takes over.",
  ),
  "realm.headlessBrowser": stable(
    "Headless browser",
    "The Chrome, Chromium or Edge executable the headless realm runs; null finds one (CHROME_PATH, then the usual install places).",
  ),
  "realm.headlessIdleMs": stable(
    "Headless idle time",
    "The headless page closes after this long with no run, snapshot, bridge call or event, in milliseconds.",
  ),
  "realm.headlessSandbox": stable(
    "Headless sandbox",
    "Run the headless browser in its sandbox. Off only where Chrome cannot start sandboxed (some containers): client cells then run without the browser's sandbox.",
  ),
  "outputs.maxValueBytes": stable(
    "Value output limit",
    "Bytes of a value output that reach the page or an API caller before truncation.",
  ),
  "outputs.maxStreamBytes": stable(
    "Stream output limit",
    "Bytes of stdout and stderr kept per execution before truncation.",
  ),
  "outputs.maxHeightPx": stable(
    "Output height",
    "Height cap of an output in the page, in pixels; inner scroll beyond it.",
  ),
  "outputs.defaultView": stable(
    "Default output view",
    "auto, tree, grid or raw; auto follows the detection rules of the viewer.",
  ),
  "outputs.expandDepth": stable("Expanded tree depth", "Tree levels expanded by default."),
  "outputs.retainFullValue": stable(
    "Retain full values",
    "Keep each cell's last full value in the daemon for paging, queries and downloads.",
  ),
  "outputs.retainMaxBytes": stable(
    "Retained bytes per notebook",
    "Bytes of full values retained per notebook; the oldest are dropped first.",
  ),
  "outputs.save": stable(
    "Save outputs",
    "Store each cell's last run in the .jsnb file: auto keeps them in a file that has them, always in every file, never in none.",
  ),
  "query.timeoutMs": stable(
    "Query timeout",
    "Wall-clock limit for one query (JSONPath, jq, SQL), in milliseconds.",
  ),
  "query.sqlMaxRows": stable(
    "SQL row cap",
    "Rows returned by a SQL query before the result is marked truncated.",
  ),
  "cells.titleFromFirstLine": stable(
    "Title from first line",
    "A cell with no title of its own is named by its first line, comment marks removed.",
  ),
  "outline.showAllCells": stable(
    "Show all cells",
    "The Explorer's outline lists every cell; off, the headings and the cells with a title, a run going, an error or an agent edit.",
  ),
  "editor.fontSize": stable("Editor font size", "Font size of the cell editors, in pixels."),
  "editor.tabSize": stable("Editor tab size", "Spaces per indentation level."),
  "editor.wordWrap": stable(
    "Word wrap",
    "Long lines wrap in the editor instead of scrolling sideways.",
  ),
  "editor.keymap": planned(
    "Keymap",
    "default or vim. vim is planned; the key is accepted and shown disabled.",
  ),
  "editor.intellisense": stable(
    "IntelliSense",
    "Completions, hover, signature help, go to definition and rename from the TypeScript service.",
  ),
  "editor.diagnostics": stable(
    "Diagnostics",
    "Type errors and unknown names underlined as you type and listed in Problems.",
  ),
  "editor.lineValues": stable(
    "Line values",
    "After a cell runs, each line that declares or assigns names shows their values at its end, in the cell that last set them.",
  ),
  "editor.syntaxTheme": stable(
    "Syntax theme",
    "Code colours, in light and dark: vscode (VS Code's Light+ and Dark+), github, cursor, jetbrains, one, catppuccin, tokyo-night or nimbo.",
  ),
  "ui.theme": stable("Theme", "system, light or dark."),
  "tutorial.showOnHome": stable(
    "Show on Home",
    "The tutorial on Home: its lessons in an empty workspace, the Tutorial view in the activity bar and the row that continues it above the notebooks. Help > Tutorial shows it again.",
  ),
  "git.enabled": stable(
    "Source Control",
    "Shows the Source Control view and the branch when the workspace folder is in a git repository.",
  ),
  "diffEditor.renderSideBySide": stable(
    "Side by side diff",
    "Diffs show the old and the new side by side; off shows them inline.",
  ),
  "notebookDiff.showEntireNotebook": stable(
    "Show entire notebook",
    "A notebook diff draws every cell, not only the changed ones and the cells around them.",
  ),
  "notebookDiff.rawMarkdown": stable(
    "Raw Markdown",
    "Markdown cells diff as source instead of rendered.",
  ),
  "notebookDiff.contextCells": stable(
    "Cells around changes",
    "Unchanged cells shown above and below each changed cell; 0 shows the changed cells alone.",
  ),
  "notebookDiff.showMetadata": stable(
    "Metadata changes",
    "A notebook diff lists changes to cell metadata (collapsed, last edit) and to the file's header.",
  ),
  "notebookDiff.hideOutputs": stable(
    "Hide outputs",
    "A notebook diff leaves out the changes to the cells' saved runs (the file's outputs).",
  ),
  "secrets.allowLiveKeys": planned(
    "Allow live keys",
    "Lets an sk_live_ key reach the kernel. Planned (the Stripe test-mode guard).",
  ),
};
