// The one dispatcher for registry and UI commands. Views, the keymap and the palette name a command id
// and its arguments; nothing binds a key or a button to a function. Create it once the session has started, provide
// it to the app (`app.provide(dispatcherKey, dispatcher)`), and read it in a view with `useDispatcher()`.
import type { CellType } from "@jsnb/core";
import type { InjectionKey } from "vue";
import { inject } from "vue";

import type { PageAttach } from "../store/notebook.js";
import { useNotebookStore } from "../store/notebook.js";
import { DispatcherMissing } from "../store/startOrder.js";
import type { NewToast } from "../store/toasts.js";
import { useUiStore } from "../store/ui.js";
import type { Mode } from "../store/ui.js";
import { cellCommands } from "./cells.js";
import { debugCommands } from "./debug.js";
import type { Args, Command } from "./command.js";
import { registryCommands } from "./registry.js";
import { uiCommands } from "./ui.js";
import { workspaceCommands } from "./workspace.js";

/** What the keyboard needs to know to pick a binding (keyboard/ reads the stores only through this). */
export type KeyContext = {
  readonly mode: Mode;
  /** The selected cell's type, or null. */
  readonly cellType: CellType | null;
  /** The palette, a menu or a dialog is open: keys belong to it, except Escape. */
  readonly overlay: boolean;
  /** An editor such as Settings covers the notebook or the list: only the window's keys act. */
  readonly page?: boolean;
};

export type Dispatcher = {
  /** Every command: the registry's public ones, then the UI's. */
  readonly commands: readonly Command[];
  readonly find: (id: string) => Command | undefined;
  /** True when `id` with `args` would run now: it exists, its when() holds and, when it writes, this tab may write
   * (a menu shows the others off). */
  readonly available: (id: string, args?: Args) => boolean;
  /** Runs `id` with `args`; false when it does not exist or cannot run now. */
  readonly dispatch: (id: string, args?: Args) => Promise<boolean>;
  /** Runs `id` with `args` as dispatch does and answers what it answered: undefined when it could not run or failed
   * (a form that keeps what was typed until its write went through). */
  readonly request: (id: string, args?: Args) => Promise<unknown>;
  readonly context: () => KeyContext;
  /** The palette's entries that change while the page is open, each a command with fixed arguments (Home's "Open
   * recent folder: …"); none on the notebook page. */
  readonly entries?: () => readonly {
    readonly command: string;
    readonly title: string;
    readonly args: Args;
  }[];
};

/** Why a command that writes cannot run now, or null when it can: the socket is live and this tab holds the page.
 * A tab whose attach is still pending or failed writes nothing either. */
function refusal(
  connection: string,
  attach: PageAttach["state"],
  closed: boolean,
): NewToast | null {
  if (closed)
    return {
      kind: "info",
      title: "Notebook closed",
      text: "Another client closed this notebook: open it again with nimbo open to run it.",
    };
  if (connection === "live" && attach === "attached") return null;
  if (connection === "viewOnly")
    return {
      kind: "info",
      title: "View only",
      text: "Another tab holds this notebook's page: runs and edits are off here.",
    };
  if (connection === "live")
    return {
      kind: "info",
      title: "No page here",
      text:
        attach === "pending"
          ? "Runs and edits wait until this tab holds the notebook's page."
          : "This tab could not take the notebook's page: runs and edits are off here.",
    };
  return { kind: "info", title: "Not connected", text: "Runs and edits wait for the daemon." };
}

export const dispatcherKey: InjectionKey<Dispatcher> = Symbol("jsnb.dispatcher");

/** Why `command` cannot run now in this tab, or null: only a command that writes can be refused. */
function refusalOf(
  command: Command,
  notebook: ReturnType<typeof useNotebookStore>,
): NewToast | null {
  return command.writes === true
    ? refusal(notebook.connection, notebook.attach.state, notebook.mirror.closed)
    : null;
}

/** True when `command` exists, its when() holds for `args` and this tab may run it. */
const canRun = (
  command: Command | undefined,
  args: Args | undefined,
  notebook: ReturnType<typeof useNotebookStore>,
) =>
  command !== undefined && command.when?.(args) !== false && refusalOf(command, notebook) === null;

export function createDispatcher(): Dispatcher {
  const ui = useUiStore();
  const notebook = useNotebookStore();
  const commands = [
    ...registryCommands(),
    ...uiCommands(),
    ...cellCommands(),
    ...debugCommands(),
    ...workspaceCommands(),
  ];
  const byId = new Map(commands.map((command) => [command.id, command]));
  const run = async (id: string, args?: Args): Promise<{ ran: boolean; answer?: unknown }> => {
    const command = byId.get(id);
    if (command === undefined || command.when?.(args) === false) return { ran: false };
    const refused = refusalOf(command, notebook);
    if (refused !== null) {
      ui.toast(refused);
      return { ran: false };
    }
    // what was typed goes first, so a run all, a run with dependents or a save acts on it
    if (command.writes === true && id !== "cell.update") await ui.flushDrafts.run();
    return { ran: true, answer: await command.run(args) };
  };
  return {
    commands,
    find: (id) => byId.get(id),
    available: (id, args) => canRun(byId.get(id), args, notebook),
    dispatch: async (id, args) => (await run(id, args)).ran,
    request: async (id, args) => (await run(id, args)).answer,
    context: () => ({
      mode: ui.mode,
      cellType: notebook.selectedCell?.type ?? null,
      overlay: ui.palette.open || ui.overlay !== null || ui.fullscreen !== null,
      page: ui.page !== null,
    }),
  };
}

/** The app's dispatcher, inside a component's setup. */
export function useDispatcher(): Dispatcher {
  const dispatcher = inject(dispatcherKey);
  if (dispatcher === undefined) throw new DispatcherMissing();
  return dispatcher;
}
