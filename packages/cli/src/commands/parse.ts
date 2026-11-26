// Reads a generated subcommand's arguments with node:util's parseArgs into its input: the flags of
// flags.ts, the global --json, --yes / -y and --help / -h, `source` from --source, --file or stdin (`--source -`),
// then the command's own Zod schema, so a bad flag is exit 2 with its issues before any daemon is contacted.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ParseArgsOptionsConfig } from "node:util";
import { parseArgs } from "node:util";

import type { AnyCommand } from "@jsnb/core";
import { InvalidParams } from "@jsnb/core";
import type { z } from "zod";

import { InvalidArguments } from "../errors/cli.js";
import type { Io } from "../io/io.js";
import type { Flag } from "./flags.js";
import { flagsOf } from "./flags.js";
import { wordsOf } from "./names.js";
import { readAll } from "./stdin.js";
import { valueOf } from "./values.js";

export type CommandLine = {
  /** The input from the flags; `notebook` may be left for the default and a secret for stdin. */
  readonly input: Readonly<Record<string, unknown>>;
  readonly json: boolean;
  readonly yes: boolean;
  readonly help: boolean;
};

/** The flags every command takes. */
export const globalOptions = {
  json: { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  help: { type: "boolean", short: "h" },
} as const satisfies ParseArgsOptionsConfig;

function optionOf(flag: Flag): ParseArgsOptionsConfig {
  if (flag.kind === "secret") return {};
  const short = flag.short === undefined ? {} : { short: flag.short };
  if (flag.kind === "boolean") return { [flag.flag]: { type: "boolean", ...short } };
  const option = {
    [flag.flag]: { type: "string", multiple: flag.kind === "list", ...short },
  } as const;
  return flag.kind === "source" ? { ...option, file: { type: "string" } } : option;
}

/** parseArgs's options for `flags` and the global ones. */
const optionsOf = (flags: readonly Flag[]): ParseArgsOptionsConfig =>
  flags.reduce<ParseArgsOptionsConfig>((all, flag) => ({ ...all, ...optionOf(flag) }), {
    ...globalOptions,
  });

/** What parseArgs read: each option's value (a list for a repeated one) and the positionals. */
export type ReadArgs = {
  readonly values: Readonly<
    Record<string, string | boolean | readonly (string | boolean)[] | undefined>
  >;
  readonly positionals: readonly string[];
};

/**
 * What to do about a value that starts with `-`, which parseArgs takes for a flag (Node's own remedy is its message's
 * third line): `--flag=-…`, and for the source stdin or a file.
 */
function dashRemedy(message: string): string {
  const flag = /'(--[a-z][a-z-]*)=/.exec(message)?.[1];
  if (flag === undefined) return "";
  const elsewhere = flag === "--source" ? ", or given with --source - (stdin) or --file" : "";
  return ` A value that starts with - is written ${flag}=-…${elsewhere}.`;
}

/** Why parseArgs refused the arguments, in the CLI's words. */
function argsReason(
  error: TypeError,
  argument: string,
  options: ParseArgsOptionsConfig,
  command: string,
): string {
  // An agent passes -n out of habit to a command of the whole workspace (packages, settings, examples)
  if ((argument === "-n" || argument === "--notebook") && options.notebook === undefined)
    return `nimbo ${command} takes no ${argument}: it acts on the whole workspace.`;
  const first = error.message.split("\n")[0] ?? "";
  return `${first.endsWith(".") ? first : `${first}.`}${dashRemedy(error.message)}`;
}

/** parseArgs, with its TypeError (an unknown flag, a missing value, a stray positional) as InvalidArguments. */
export function readArgs(
  argv: readonly string[],
  options: ParseArgsOptionsConfig,
  command: string,
  allowPositionals = false,
): ReadArgs {
  try {
    return parseArgs({
      args: [...argv],
      options,
      strict: true,
      allowPositionals,
      allowNegative: true,
    });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    const argument = /'(-[^' ]+)/.exec(error.message)?.[1] ?? argv.join(" ");
    throw new InvalidArguments(
      { argument, command },
      argsReason(error, argument, options, command),
      {
        cause: error,
      },
    );
  }
}

type Values = Readonly<
  Record<string, string | boolean | readonly (string | boolean)[] | undefined>
>;

/** `source` from --source (`-` for stdin) or --file; both at once is a usage error. */
async function sourceOf(values: Values, io: Io, command: string): Promise<string | undefined> {
  const text = values.source;
  const file = values.file;
  if (typeof text === "string" && typeof file === "string") {
    throw new InvalidArguments(
      { argument: "--file", command },
      "Give the source with --source or --file, not both.",
    );
  }
  if (text === "-") return readAll(io.stdin);
  if (typeof file !== "string") return typeof text === "string" ? text : undefined;
  try {
    return await readFile(resolve(io.cwd, file), "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new InvalidArguments(
      { argument: "--file", command },
      `--file ${file} cannot be read: ${reason}.`,
      { cause: error },
    );
  }
}

/** The input the flags give, without validation. */
async function inputOf(
  command: AnyCommand,
  values: Values,
  io: Io,
): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = {};
  for (const flag of flagsOf(command)) {
    const raw =
      flag.kind === "source" ? await sourceOf(values, io, wordsOf(command)) : values[flag.flag];
    if (raw !== undefined) input[flag.key] = valueOf(command, flag, raw);
  }
  return input;
}

/** Validates `input` with the command's schema; the keys still to come (notebook, a secret) take a stand-in. */
export function validate(
  command: AnyCommand,
  input: Readonly<Record<string, unknown>>,
  pending: Readonly<Record<string, unknown>> = {},
  labels: Readonly<Record<string, string>> = {},
): void {
  const result = command.input.safeParse({ ...pending, ...input });
  if (result.success) return;
  const byKey = new Map(
    flagsOf(command).map((flag) => [flag.key, labels[flag.key] ?? `--${flag.flag}`]),
  );
  const issues = result.error.issues.map((issue) => {
    const [first, ...rest] = issue.path;
    const flag = typeof first === "string" ? (byKey.get(first) ?? first) : first;
    return { path: flag === undefined ? [] : [flag, ...rest], message: issue.message };
  });
  throw new InvalidParams({ issues });
}

/** The stand-ins of what the CLI fills in after reading the flags. */
export function pendingOf(
  command: AnyCommand,
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const pending: Record<string, unknown> = {};
  for (const flag of flagsOf(command)) {
    if (flag.key in input) continue;
    if (flag.key === "notebook" || flag.kind === "secret") pending[flag.key] = "-";
  }
  return pending;
}

/** The command line of `command`: its input, checked, and the global flags. */
export async function parseCommandLine(
  command: AnyCommand,
  argv: readonly string[],
  io: Io,
): Promise<CommandLine> {
  const { values } = readArgs(argv, optionsOf(flagsOf(command)), wordsOf(command));
  const help = values.help === true;
  const json = values.json === true;
  const yes = values.yes === true;
  if (help) return { input: {}, json, yes, help };
  const input = await inputOf(command, values, io);
  validate(command, input, pendingOf(command, input));
  return { input, json, yes, help };
}

/** `input` checked with the command's schema (InvalidParams naming the flags), as the schema reads it. */
export function checkedInput<I extends z.ZodObject>(
  command: { readonly input: I } & AnyCommand,
  input: Readonly<Record<string, unknown>>,
  labels: Readonly<Record<string, string>> = {},
): z.output<I> {
  validate(command, input, {}, labels);
  return command.input.parse(input);
}
