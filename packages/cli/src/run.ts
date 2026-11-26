// `run(argv, io)`, the whole CLI: --help and --version, a shortcut, or `<domain> <verb>` generated from the
// registry, and bare `nimbo` on a terminal the Home page; every failure printed (as JSON under --json) and turned
// into its exit code. It never throws.
import { runGenerated } from "./commands/invoke.js";
import { domainHelp } from "./commands/help.js";
import { findCommand } from "./commands/names.js";
import { InvalidArguments, OutputClosed } from "./errors/cli.js";
import type { ExitCode } from "./errors/exit.js";
import { exitCodeOf, exitCodes } from "./errors/exit.js";
import { errorReport } from "./errors/report.js";
import { rootHelp } from "./help.js";
import { colourOn, painter } from "./io/colour.js";
import type { Io } from "./io/io.js";
import { unicodeOn } from "./io/screen.js";
import { guard, write } from "./io/io.js";
import { shortcutNamed } from "./shortcuts/all.js";
import { openHome } from "./shortcuts/open.js";
import { markedWorkspace } from "./daemon/workspace.js";
import { versionText } from "./version.js";

const isHelp = (word: string | undefined): boolean => word === "--help" || word === "-h";

/** `nimbo <domain> [verb]`: the domain's help, or its command. */
async function domain(
  name: string,
  rest: readonly string[],
  io: Io,
): Promise<ExitCode | undefined> {
  const help = domainHelp(name);
  if (help === undefined) return undefined;
  const [verb, ...argv] = rest;
  if (verb === undefined || isHelp(verb)) {
    await write(verb === undefined ? io.stderr : io.stdout, help);
    return verb === undefined ? exitCodes.usage : exitCodes.ok;
  }
  const command = findCommand(name, verb);
  if (command === undefined) {
    throw new InvalidArguments(
      { argument: verb, command: name },
      `nimbo ${name} has no verb ${verb}.`,
    );
  }
  return runGenerated(command, argv, io);
}

/** The flags every command takes, also accepted before the command's words (`nimbo --json workspace info`). */
const leading = new Set(["--json", "--yes", "-y"]);

/**
 * A person at a terminal: stdin and stdout both one. An agent's or a script's `nimbo` (a pipe, a captured output, no
 * stdin) is not, and gets the root help.
 */
const interactive = (io: Io): boolean => io.isTTY && io.outputIsTTY === true;

/** What bare nimbo on a terminal adds to the help outside a workspace. */
const noWorkspaceHint =
  "No workspace here (no .jsnb/ folder in this folder or above it): nimbo open makes this folder one and opens its Home page.";

/**
 * No command named: bare nimbo on a terminal inside a workspace opens the Home page; anywhere else, and for
 * global flags alone (`nimbo --yes`), the root help on stderr with exit 2, which outside a workspace says how to make one.
 */
async function noCommand(argv: readonly string[], io: Io): Promise<ExitCode> {
  const typed = argv.length === 0 && interactive(io);
  // only inside a workspace: a nimbo typed in a folder that is none (the home folder) starts no daemon there
  if (typed && (await markedWorkspace(io.cwd)) !== undefined) return openHome(io);
  const hint = typed ? `\n${noWorkspaceHint}\n` : "";
  await write(io.stderr, `${rootHelp()}${hint}`);
  return exitCodes.usage;
}

async function dispatch(argv: readonly string[], io: Io): Promise<ExitCode> {
  if (argv.every((arg) => leading.has(arg))) return noCommand(argv, io);
  const [first = "", ...rest] = argv;
  if (isHelp(first)) {
    await write(io.stdout, rootHelp());
    return exitCodes.ok;
  }
  if (first === "--version") {
    await write(io.stdout, await versionText());
    return exitCodes.ok;
  }
  const shortcut = shortcutNamed(first);
  if (shortcut !== undefined) return shortcut.run(rest, io);
  const code = await domain(first, rest, io);
  if (code !== undefined) return code;
  throw new InvalidArguments({ argument: first, command: "" }, `nimbo has no command ${first}.`);
}

/** The arguments with leading global flags moved behind the command's words, where each command reads them. */
function reordered(argv: readonly string[]): readonly string[] {
  const front = argv.findIndex((arg) => !leading.has(arg));
  if (front <= 0) return argv;
  const words = argv.slice(front);
  const [first, second] = words;
  const domainWords =
    second !== undefined && !second.startsWith("-") && shortcutNamed(first ?? "") === undefined
      ? 2
      : 1;
  return [...words.slice(0, domainWords), ...argv.slice(0, front), ...words.slice(domainWords)];
}

/** Writes the failure's report; a stderr that is gone too leaves nothing to tell. */
async function report(io: Io, error: unknown, asJson: boolean): Promise<void> {
  const style = { paint: painter(colourOn(io, "stderr")), unicode: unicodeOn(io.env) };
  const text = errorReport(error, asJson, style);
  if (text === "") return;
  try {
    await write(io.stderr, text);
  } catch (failure) {
    if (!(failure instanceof OutputClosed)) throw failure;
  }
}

/** Runs the CLI over `io`; resolves to the exit code and never rejects. */
export async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  guard(io.stdout);
  guard(io.stderr);
  const args = reordered(argv);
  try {
    return await dispatch(args, io);
  } catch (error) {
    await report(io, error, args.includes("--json"));
    return exitCodeOf(error);
  }
}
