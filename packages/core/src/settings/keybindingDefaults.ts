// The default keys: VS Code's for the window and Jupyter's command-mode keys as VS Code's notebooks have
// them, each under a when clause (keybindingWhen.ts); the user's and the workspace's keybindings.json apply over them.
import type { KeybindingSource } from "../model/keybinding.js";

/** A binding in effect: canonical key, its when clause as written once normalised ("" anywhere), the file it is from. */
export type Keybinding = {
  readonly key: string;
  readonly command: string;
  readonly when: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly source: KeybindingSource;
};

/** A default binding: a binding with no file. */
export type DefaultBinding = Omit<Keybinding, "source">;

const row = (
  keys: readonly string[],
  command: string,
  when = "",
  args?: Readonly<Record<string, unknown>>,
): readonly DefaultBinding[] =>
  keys.map((key) => ({ key, command, when, ...(args === undefined ? {} : { args }) }));

const nb = "notebook";
const nbCommand = "notebook && commandMode";
const homeCommand = "home && commandMode";

/** The default keys: VS Code's for the window (Cmd Shift P, Cmd K Cmd S, Cmd ,, Cmd B, Cmd Alt B, Cmd J, Cmd Shift
 * E/F/M, Cmd K Cmd 0, Shift F10) and Jupyter's command-mode keys as VS Code's notebooks have them; Home's list
 * keys. The page's commands (`ui.*`) live in the page; the others are registry commands. */
export const defaultKeybindings: readonly DefaultBinding[] = [
  ...row(["Mod+Shift+P", "F1"], "ui.palette.open"),
  ...row(["Escape"], "ui.escape"),
  ...row(["Shift+Enter", "Mod+Enter", "Escape"], "ui.mode.command", "notebook && markdownEditing"),
  ...row(["Shift+Enter"], "ui.run.advance", nb),
  ...row(["Mod+Enter"], "ui.run.inPlace", nb),
  ...row(["Alt+Shift+Enter"], "ui.run.withDependents", nb),
  ...row(["Mod+Shift+Enter"], "notebook.run", nb, { select: "all" }),
  ...row(["Mod+S"], "notebook.save", nb),
  ...row(["Mod+K Mod+S"], "ui.shortcuts.open"),
  ...row(["Mod+,"], "ui.settings.open"),
  ...row(["Mod+B"], "ui.panel.toggle", nb),
  // the inspector is VS Code's secondary side bar
  ...row(["Mod+Alt+B"], "ui.inspector.toggle", nb),
  ...row(["Mod+J"], "ui.bottom.toggle", nb),
  ...row(["Mod+Shift+E"], "ui.panel.open", nb, { which: "explorer" }),
  ...row(["Mod+Shift+F"], "ui.panel.open", nb, { which: "search" }),
  ...row(["Mod+Shift+M"], "ui.panel.open", nb, { which: "problems" }),
  // Source Control, as VS Code: Ctrl Shift G on both pages; Alt F5 and Shift Alt F5 step through a diff's changes
  ...row(["Ctrl+Shift+G"], "ui.panel.open", nb, { which: "sourceControl" }),
  ...row(["Ctrl+Shift+G"], "ui.home.view.open", "home", { view: "sourceControl" }),
  ...row(["Mod+Shift+E"], "ui.home.view.open", "home", { view: "explorer" }),
  ...row(["Alt+F5"], "ui.diff.next"),
  ...row(["Alt+Shift+F5"], "ui.diff.previous"),
  // the debugger, VS Code's keys (each key does nothing while its command cannot act)
  ...row(["F5"], "ui.debug.continue", nb),
  ...row(["F6"], "ui.debug.pause", nb),
  ...row(["F10"], "ui.debug.stepOver", nb),
  ...row(["F11"], "ui.debug.stepInto", nb),
  ...row(["Shift+F11"], "ui.debug.stepOut", nb),
  ...row(["Shift+F5"], "ui.debug.stop", nb),
  ...row(["F9"], "ui.debug.toggleBreakpoint", nb),
  ...row(["Mod+Shift+D"], "ui.panel.open", nb, { which: "debug" }),
  // the context menu key, as VS Code opens a focused item's menu
  ...row(["Shift+F10"], "ui.cellMenu.open", nbCommand),
  ...row(["Alt+Enter"], "ui.run.insertBelow", nb),
  ...row(["ArrowUp", "K"], "ui.select.previous", nbCommand),
  ...row(["ArrowDown", "J"], "ui.select.next", nbCommand),
  ...row(["Shift+ArrowUp", "Shift+K"], "ui.select.extendPrevious", nbCommand),
  ...row(["Shift+ArrowDown", "Shift+J"], "ui.select.extendNext", nbCommand),
  ...row(["Enter"], "ui.mode.edit", nbCommand),
  ...row(["A"], "ui.cell.addAbove", nbCommand),
  ...row(["B"], "ui.cell.addBelow", nbCommand),
  // a server, client or markdown cell below, the add buttons' keys (their tooltips show them), letters as in T S, T C, M
  ...row(["Shift+S"], "ui.cell.addBelow", nbCommand, { type: "server" }),
  ...row(["Shift+C"], "ui.cell.addBelow", nbCommand, { type: "client" }),
  ...row(["Shift+M"], "ui.cell.addBelow", nbCommand, { type: "markdown" }),
  ...row(["M", "T M"], "ui.cell.type", nbCommand, { type: "markdown" }),
  ...row(["Y"], "ui.cell.toCode", nbCommand),
  ...row(["T S"], "ui.cell.type", nbCommand, { type: "server" }),
  ...row(["T C"], "ui.cell.type", nbCommand, { type: "client" }),
  ...row(["C"], "ui.cells.copy", nbCommand),
  ...row(["X"], "ui.cells.cut", nbCommand),
  ...row(["V"], "ui.cells.paste", nbCommand, { where: "below" }),
  ...row(["Shift+V"], "ui.cells.paste", nbCommand, { where: "above" }),
  ...row(["D D"], "cell.delete", nbCommand),
  ...row(["Z", "Mod+Z"], "undo.restore", nbCommand),
  ...row(["Alt+ArrowUp"], "ui.cell.moveUp", nbCommand),
  ...row(["Alt+ArrowDown"], "ui.cell.moveDown", nbCommand),
  // JupyterLab's keys for the heading sections
  ...row(["ArrowLeft"], "ui.section.collapse", nbCommand),
  ...row(["ArrowRight"], "ui.section.expand", nbCommand),
  ...row(["O"], "ui.cell.toggleOutputs", nbCommand),
  // F2: rename the selected cell, as VS Code and JetBrains rename the selected item (edit mode's F2 renames a symbol)
  ...row(["F2"], "ui.cell.rename", nbCommand),
  // N: Jupyter's Z and V are undo and paste here, so the values view takes a key JupyterLab's command mode leaves free;
  // Space folds or unfolds the selected cell, as a click on its header does (the owner, 2026-11-15)
  ...row(["N"], "ui.cell.toggleValues", nbCommand),
  ...row(["Space"], "ui.cell.toggleCollapse", nbCommand),
  // Cmd K Cmd 0: VS Code's Fold All, here every cell to its header and back
  ...row(["Mod+K Mod+0"], "ui.cells.foldAll", nb),
  // P: pin the selected cell's result to the inspector, or unpin it (JupyterLab's command mode leaves P free)
  ...row(["P"], "ui.cell.pin", nbCommand),
  // feedback mode: Cmd Alt F on both pages, wherever the focus is
  ...row(["Mod+Alt+F"], "ui.feedback.toggle"),
  ...row(["I I"], "kernel.interrupt", nbCommand),
  ...row(["0 0"], "kernel.restart", nbCommand),
  ...row(["ArrowUp", "K"], "ui.home.select.previous", homeCommand),
  ...row(["ArrowDown", "J"], "ui.home.select.next", homeCommand),
  ...row(["Enter"], "ui.notebook.open", homeCommand),
  ...row(["N"], "ui.notebook.new", homeCommand),
  ...row(["F2"], "ui.notebook.rename", homeCommand),
  ...row(["Delete", "Backspace"], "ui.notebook.delete", homeCommand),
  ...row(["Mod+B"], "ui.home.side.toggle", "home"),
];
