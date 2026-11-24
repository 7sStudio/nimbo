// The command palette's catalogue (08 §8 rule 3): every registry command that is not internal and every
// UI command a user can choose, plus the bound variants with fixed arguments (Run all, Run stale, Restart all, a cell
// type, a panel), each with its keymap shortcut. The palette shows the ones whose when() holds for their arguments,
// recently used first.
import type { Args, Command } from "../commands/command.js";
import { allKeysFor } from "../keyboard/keymap.js";
import { variants } from "../commands/labels.js";

export type PaletteEntry = {
  /** Unique in the catalogue: the command id, with its arguments when it has any. */
  readonly key: string;
  readonly command: string;
  readonly args?: Args;
  readonly title: string;
  /** Every key bound to it, shown on its one row. */
  readonly keys: readonly string[];
};

/** UI commands that are the palette's own plumbing, the keyboard's, or a click's (selecting a cell is the Cells section's
 * job, the kernel-exited banner's Kernel log button is ui.kernelLog.open, which the palette offers as "Open the Kernel log
 * panel"): choosing them from the Commands list means nothing new. */
const plumbing = new Set([
  "ui.palette.open",
  "ui.palette.close",
  "ui.escape",
  "ui.overlay.close",
  "ui.mode.command",
  "ui.select",
  "ui.edit.previous",
  "ui.edit.next",
  "ui.kernelLog.open",
]);

function entry(command: string, title: string, args?: Args): PaletteEntry {
  return {
    key: args === undefined ? command : `${command} ${JSON.stringify(args)}`,
    command,
    title,
    ...(args === undefined ? {} : { args }),
    keys: allKeysFor(command, args),
  };
}

/** Every entry of the catalogue for `commands` (the dispatcher's): the variants and the page's own commands, in the
 * words a user looks for, then the registry's by name. */
export function paletteCatalogue(commands: readonly Command[]): readonly PaletteEntry[] {
  const known = new Set(commands.map((command) => command.id));
  const chosen = commands.filter((command) => !plumbing.has(command.id));
  const page = [
    ...variants
      .filter((variant) => known.has(variant.command))
      .map((variant) => entry(variant.command, variant.title, variant.args)),
    ...chosen
      .filter((command) => command.source === "ui")
      .map((command) => entry(command.id, command.title)),
  ];
  // a page command that wraps a registry one (Cancel Install, Revert Agent Edit) is the one row under that name
  const named = new Set(page.map((each) => each.title));
  return [
    ...page,
    ...chosen
      .filter((command) => command.source === "registry" && !named.has(command.title))
      .map((command) => entry(command.id, command.title)),
  ];
}

/** The dispatcher's changing entries (Home's recent folders) as catalogue entries, each with its keys (none). */
export const liveEntries = (
  entries: readonly { readonly command: string; readonly title: string; readonly args: Args }[],
): readonly PaletteEntry[] => entries.map((each) => entry(each.command, each.title, each.args));

/** What a registry command that only reads answered, as one line for its toast (the palette shows what it read). */
export function answerLine(answer: unknown): string {
  const text = answer === undefined ? "" : JSON.stringify(answer);
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}

/** The entries to show now: those whose command can run with their arguments, the recently used first. */
export function shownEntries(
  catalogue: readonly PaletteEntry[],
  find: (id: string) => Command | undefined,
  recent: readonly string[],
): readonly PaletteEntry[] {
  const rank = (entry: PaletteEntry) => {
    const at = recent.indexOf(entry.command);
    return at === -1 ? recent.length : at;
  };
  return catalogue
    .filter((entry) => find(entry.command)?.when?.(entry.args) !== false)
    .map((entry, at) => ({ entry, at }))
    .sort((a, b) => rank(a.entry) - rank(b.entry) || a.at - b.at)
    .map(({ entry }) => entry);
}
