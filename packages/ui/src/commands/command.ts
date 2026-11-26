// The one command shape shared by registry and UI commands: `{ id, title, run, when? }`. Keys are not here:
// keyboard/keymap.ts is the one table that binds keys to command ids.
import { keymapTitles } from "./labels.js";

export type Args = Readonly<Record<string, unknown>>;

export type Command = {
  /** A registry name (`cell.run`) or a UI command (`ui.panel.toggle`, `undo.restore`). */
  readonly id: string;
  readonly title: string;
  /** "registry" for the registry's commands, "ui" for the page's own. */
  readonly source: "registry" | "ui";
  /** True for a command that changes the notebook or the kernel (a registry command tagged mutating or destructive,
   * and the UI commands that send one): the dispatcher refuses it unless the socket is live and this tab holds the
   * page, so a view-only tab's keys and buttons change nothing. */
  readonly writes?: boolean;
  /** False when the command cannot run now (nothing selected, a planned command, arguments only a panel can give). */
  readonly when?: (args?: Args) => boolean;
  /** Runs it; failures are shown as toasts by the stores, never thrown at the caller. */
  readonly run: (args?: Args) => unknown;
};

/** A UI command (`source: "ui"`), named by labels.ts's one table when it has the id, else by `title`. */
export const uiCommand = (
  id: string,
  title: string,
  run: Command["run"],
  when?: Command["when"],
): Command => ({
  id,
  title: keymapTitles[id] ?? title,
  source: "ui",
  run,
  ...(when === undefined ? {} : { when }),
});

/** A string argument, or undefined. */
export const stringArg = (args: Args | undefined, key: string): string | undefined => {
  const value = args?.[key];
  return typeof value === "string" ? value : undefined;
};

/** `cell.outputQuery` → `Cell: output query`. */
export function titleOf(name: string): string {
  const [domain = "", verb = ""] = name.split(".");
  const words = verb.replace(/([A-Z])/g, " $1").toLowerCase();
  return `${domain.charAt(0).toUpperCase()}${domain.slice(1)}: ${words}`;
}
