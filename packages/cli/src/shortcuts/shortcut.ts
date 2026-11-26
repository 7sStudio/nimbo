// What every hand-written shortcut shares: its name, usage and help, its arguments read with parseArgs
// beside the global flags, the daemon session it opens (and closes), and the notebook it addresses.
import type { ParseArgsOptionsConfig } from "node:util";

import { globalOptions, readArgs } from "../commands/parse.js";
import { defaultNotebook, presetNotebook } from "../daemon/notebook.js";
import type { Session } from "../daemon/session.js";
import { openSession } from "../daemon/session.js";
import { InvalidArguments } from "../errors/cli.js";
import type { ExitCode } from "../errors/exit.js";
import type { Io } from "../io/io.js";

export type Shortcut = {
  readonly name: string;
  /** `outputs <cell> [--where <chips> | …]`, as the root help lists it. */
  readonly usage: string;
  readonly summary: string;
  /** The whole `nimbo <name> --help`. */
  readonly help: string;
  readonly run: (argv: readonly string[], io: Io) => Promise<ExitCode>;
};

type Raw = string | boolean | readonly (string | boolean)[] | undefined;

export type ShortcutArgs = {
  /** The shortcut's name, for its errors' help line. */
  readonly name: string;
  readonly values: Readonly<Record<string, Raw>>;
  readonly positionals: readonly string[];
  readonly json: boolean;
  readonly help: boolean;
};

/** `-n / --notebook`, which every shortcut that addresses a notebook takes. */
export const notebookOption = { notebook: { type: "string", short: "n" } } as const;

/** The help's line for `-n`: a path from the workspace root, as every command takes it, and its default. */
export const notebookFlagHelp = `  -n, --notebook <path>   the notebook's path from the workspace root, whatever the working folder; defaults to
                          NIMBO_NOTEBOOK, else the only open notebook, else the only .jsnb file`;

/** The shortcut's arguments: its own options and the global ones; positionals only where it takes them. */
export function readShortcut(
  name: string,
  argv: readonly string[],
  options: ParseArgsOptionsConfig,
  takes: { readonly min: number; readonly max: number },
): ShortcutArgs {
  const { values, positionals } = readArgs(
    argv,
    { ...globalOptions, ...options },
    name,
    takes.max > 0,
  );
  const help = values.help === true;
  if (!help && (positionals.length < takes.min || positionals.length > takes.max)) {
    const reason =
      positionals.length < takes.min
        ? `nimbo ${name} needs ${String(takes.min)} argument${takes.min === 1 ? "" : "s"}.`
        : `nimbo ${name} takes at most ${String(takes.max)} argument${takes.max === 1 ? "" : "s"}; ${positionals.slice(takes.max).join(" ")} is one too many.`;
    throw new InvalidArguments({ argument: positionals.at(-1) ?? name, command: name }, reason);
  }
  return { name, values, positionals, json: values.json === true, help };
}

/** A string option's value, or undefined. */
export const stringOf = (value: Raw): string | undefined =>
  typeof value === "string" ? value : undefined;

/** Runs `work` with a session to the daemon, closed afterwards. */
export async function withSession<T>(
  io: Io,
  options: { readonly start: boolean; readonly command: string },
  work: (session: Session) => Promise<T>,
): Promise<T> {
  const session = await openSession(io, options);
  try {
    return await work(session);
  } finally {
    session.close();
  }
}

/** The notebook -n names, else NIMBO_NOTEBOOK, from the workspace root; undefined when neither does. */
const presetOf = (args: ShortcutArgs, io: Io): Promise<string | undefined> =>
  presetNotebook(io, stringOf(args.values.notebook), args.name);

/**
 * Runs `work` with a session and the notebook the shortcut addresses: -n or NIMBO_NOTEBOOK, read before the session so
 * a path outside the workspace contacts no daemon, else the default notebook.
 */
export async function withNotebook<T>(
  io: Io,
  args: ShortcutArgs,
  options: { readonly start: boolean; readonly command: string },
  work: (session: Session, notebook: string) => Promise<T>,
): Promise<T> {
  const preset = await presetOf(args, io);
  return withSession(io, options, async (session) =>
    work(session, preset ?? (await defaultNotebook(session))),
  );
}
