// The page's workspace commands: install packages (the Packages panel's input and the Install buttons a
// MissingPackage run offers), remove one and cancel the run under way, set a secret and write a setting, through their stores, so the installing banner shows
// from the click and the secret names are read again after a set. All write: a view-only or closed tab refuses them
// (nothing writes there).
import { settingsKeys } from "@jsnb/core";
import { notebookExport } from "@jsnb/core";

import { useSettingsStore } from "../store/settings.js";
import { useSessionStore } from "../store/socket.js";
import { useUiStore } from "../store/ui.js";
import { useWorkspaceStore } from "../store/workspace.js";
import type { Args, Command } from "./command.js";
import { stringArg, uiCommand as ui } from "./command.js";

/** The `names` argument: the non-empty strings of an array, or none. */
const namesArg = (args: Args | undefined): readonly string[] => {
  const names = args?.names;
  return Array.isArray(names)
    ? names.filter((name): name is string => typeof name === "string" && name.trim() !== "")
    : [];
};

const keyArg = (args: Args | undefined) =>
  settingsKeys.find((key) => key === stringArg(args, "key"));
const scopeArg = (args: Args | undefined) =>
  stringArg(args, "scope") === "user" ? "user" : "workspace";

/** Install, remove and cancel the run under way: one run at a time, as the daemon runs them. */
function packageCommands(workspace: ReturnType<typeof useWorkspaceStore>): readonly Command[] {
  const free = (args: Args | undefined) =>
    namesArg(args).length > 0 && workspace.installing === null;
  return [
    ui(
      "ui.packages.install",
      "Install packages",
      (args) => workspace.addPackages(namesArg(args)),
      free,
    ),
    ui(
      "ui.packages.remove",
      "Remove packages",
      (args) => workspace.removePackages(namesArg(args)),
      free,
    ),
    ui(
      "ui.packages.cancel",
      "Cancel the package install",
      () => workspace.cancelPackages(),
      () => workspace.installing !== null,
    ),
  ].map((command) => ({ ...command, writes: true }));
}

/** File > Export as HTML: notebook.export's page, saved by the browser as `<name>.html`. */
function exportCommand(): Command {
  const session = useSessionStore();
  const store = useUiStore();
  return ui(
    "ui.notebook.exportHtml",
    "Export the notebook as an HTML page",
    async () => {
      const { client, notebook } = session.session();
      try {
        const { html } = await client.call(notebookExport, { notebook });
        const name = `${(notebook.split("/").pop() ?? "notebook").replace(/\.jsnb$/u, "")}.html`;
        const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
        const link = Object.assign(document.createElement("a"), { href: url, download: name });
        link.click();
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 10_000);
        store.toast({ kind: "success", title: `Exported ${name}` });
      } catch (error) {
        store.toast({
          kind: "error",
          title: "Export failed",
          text: error instanceof Error ? error.message : String(error),
        });
      }
    },
    () => session.current !== null,
  );
}

export function workspaceCommands(): readonly Command[] {
  const workspace = useWorkspaceStore();
  const settings = useSettingsStore();
  return [
    exportCommand(),
    {
      ...ui(
        "ui.settings.set",
        "Write a setting",
        (args) => {
          const key = keyArg(args);
          return key === undefined ? undefined : settings.set(key, args?.value, scopeArg(args));
        },
        (args) => keyArg(args) !== undefined && args !== undefined && "value" in args,
      ),
      writes: true,
    },
    ...packageCommands(workspace),
    {
      ...ui(
        "ui.secrets.set",
        "Set a secret",
        (args) =>
          workspace.setSecret(stringArg(args, "name") ?? "", stringArg(args, "value") ?? ""),
        (args) => stringArg(args, "name") !== undefined && stringArg(args, "value") !== undefined,
      ),
      writes: true,
    },
  ];
}
