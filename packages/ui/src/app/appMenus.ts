// The title bar's menus on each page, as VS Code and Cursor have them: File, Edit, View, Run and Help on a notebook,
// File, View and Help on Home. Settings, Keyboard Shortcuts and the theme are under File > Preferences on both. Each item names a command id with its arguments, never a function; its keys come from
// the keymap, the user's own keys included.
import type { MenuItem } from "../overlays/menus.js";
import { item } from "./menuItem.js";

export type AppMenuSpec = { readonly label: string; readonly items: readonly MenuItem[] };

/** The panel and row classes of the menu bar's menus (the dropdown menus' look). */
export const menuPanel =
  "ui:z-(--z-overlay) ui:overflow-y-auto ui:rounded-control ui:border ui:border-border ui:bg-bg ui:p-1 ui:text-ui ui:text-fg ui:shadow-pop ui:min-inline-[14rem]";
export const menuRow =
  "ui:relative ui:flex ui:cursor-default ui:items-center ui:gap-2 ui:rounded-small ui:px-2 ui:py-1 ui:select-none ui:data-[disabled]:pointer-events-none ui:data-[disabled]:opacity-45 ui:data-[highlighted]:bg-surface-2 ui:data-[state=open]:bg-surface-2";

const line: MenuItem = { kind: "separator" };

const help = (): AppMenuSpec => ({
  label: "Help",
  items: [
    item("Show All Commands", "ui.palette.open"),
    line,
    item("Feedback Mode", "ui.feedback.toggle"),
    item("Show Feedback", "ui.feedback.list"),
  ],
});

const themeNames = { system: "System", light: "Light", dark: "Dark" } as const;

/** Preferences > Theme: the three choices, the current one marked; each choice writes the setting in the scope that
 * decides it now (commands/app.ts). */
const themeMenu = (theme: string): MenuItem => ({
  kind: "sub",
  label: "Theme",
  items: Object.entries(themeNames).map(([each, label]) => ({
    ...item(label, "ui.theme.set", { theme: each }),
    ...(theme === each ? { current: true } : {}),
  })),
});

/** The syntax themes' names in the menu, in editor.syntaxTheme's order. */
const syntaxNames: Readonly<Record<string, string>> = {
  vscode: "VS Code",
  github: "GitHub",
  cursor: "Cursor",
  jetbrains: "JetBrains",
  one: "One",
  catppuccin: "Catppuccin",
  "tokyo-night": "Tokyo Night",
  nimbo: "Nimbo",
};

/** Preferences > Syntax Theme: the code colours, as VS Code's Color Theme picker, the current one marked. */
const syntaxMenu = (syntax: string): MenuItem => ({
  kind: "sub",
  label: "Syntax Theme",
  items: Object.entries(syntaxNames).map(([id, label]) => ({
    ...item(label, "ui.syntaxTheme.set", { theme: id }),
    ...(syntax === id ? { current: true } : {}),
  })),
});

/** File > Preferences, as VS Code has it: Settings, Keyboard Shortcuts, the theme and the code colours. */
const preferences = (theme: string, syntax: string): MenuItem => ({
  kind: "sub",
  label: "Preferences",
  items: [
    item("Settings", "ui.settings.open"),
    item("Keyboard Shortcuts", "ui.shortcuts.open"),
    themeMenu(theme),
    syntaxMenu(syntax),
  ],
});

/** Home's menus; `examples` are the notebooks shipped with the app (File > New from Example). */
export function homeMenus(
  examples: readonly { readonly name: string; readonly title: string }[],
  theme: string,
  syntax = "vscode",
): readonly AppMenuSpec[] {
  return [
    {
      label: "File",
      items: [
        item("New Notebook", "ui.notebook.new"),
        {
          kind: "sub",
          label: "New from Example",
          items: examples.map((each) => item(each.title, "ui.home.example", { name: each.name })),
        },
        line,
        item("Open Folder…", "ui.home.openFolder"),
        item("Refresh", "ui.home.refresh"),
        line,
        preferences(theme, syntax),
      ],
    },
    {
      label: "View",
      items: [
        item("Command Palette", "ui.palette.open"),
        line,
        item("Explorer", "ui.home.side.toggle"),
      ],
    },
    help(),
  ];
}

const notebookFile = (theme: string, syntax: string): AppMenuSpec => ({
  label: "File",
  items: [
    item("New Notebook", "ui.home.open", { new: true }),
    line,
    item("Save", "notebook.save"),
    item("Reload from Disk", "notebook.reload"),
    item("Export as HTML…", "ui.notebook.exportHtml"),
    line,
    preferences(theme, syntax),
    line,
    item("Go to Home", "ui.home.open"),
  ],
});

const notebookEdit = (): AppMenuSpec => ({
  label: "Edit",
  items: [
    item("Undo Delete", "undo.restore"),
    line,
    item("Cut Cells", "ui.cells.cut"),
    item("Copy Cells", "ui.cells.copy"),
    item("Paste Cells Below", "ui.cells.paste", { where: "below" }),
    line,
    item("Add Cell Above", "ui.cell.addAbove"),
    item("Add Cell Below", "ui.cell.addBelow"),
    item("Move Cell Up", "ui.cell.moveUp"),
    item("Move Cell Down", "ui.cell.moveDown"),
    item("Delete Cell", "cell.delete"),
    line,
    item("Find in Output", "ui.output.find"),
  ],
});

const notebookView = (): AppMenuSpec => ({
  label: "View",
  items: [
    item("Command Palette", "ui.palette.open"),
    line,
    // VS Code's View > Explorer and Search show the view, as Cmd Shift E and F do
    ...(["Explorer", "Search", "Environment", "Agent"] as const).map((view) =>
      item(view, "ui.panel.open", { which: view.toLowerCase() }),
    ),
    line,
    item("Side Bar", "ui.panel.toggle"),
    item("Panel", "ui.bottom.toggle"),
    item("Inspector", "ui.inspector.toggle"),
    line,
    item("Console", "ui.panel.open", { which: "console" }),
    item("Problems", "ui.panel.open", { which: "problems" }),
    item("Activity", "ui.panel.open", { which: "activity" }),
    item("Kernel Log", "ui.panel.open", { which: "kernelLog" }),
    line,
    item("Fold All Cells", "ui.cells.foldAll"),
  ],
});

const notebookRun = (): AppMenuSpec => ({
  label: "Run",
  items: [
    item("Run Cell", "ui.run.inPlace"),
    item("Run Cell and Advance", "ui.run.advance"),
    item("Run Cell with Dependents", "ui.run.withDependents"),
    item("Run All Above", "ui.run.above"),
    item("Run Cell and Below", "ui.run.below"),
    item("Start Debugging", "ui.debug.start"),
    line,
    item("Run All", "notebook.run", { select: "all" }),
    item("Run Stale Cells", "notebook.run", { select: { stale: true } }),
    line,
    item("Clear Cell Output", "ui.cell.clearOutput"),
    item("Clear All Outputs", "notebook.clearOutputs"),
    line,
    item("Interrupt", "kernel.interrupt"),
    item("Restart Kernel", "kernel.restart"),
    item("Restart Kernel and Page", "kernel.restart", { all: true }),
    item("Restart Kernel and Run All", "ui.kernel.restartRunAll"),
  ],
});

/** The notebook page's menus. */
export function notebookMenus(theme: string, syntax = "vscode"): readonly AppMenuSpec[] {
  return [notebookFile(theme, syntax), notebookEdit(), notebookView(), notebookRun(), help()];
}

/** The ui.theme setting's value as the menus read it: "system" unless it is a string. */
export const themeOf = (value: unknown): string => (typeof value === "string" ? value : "system");
