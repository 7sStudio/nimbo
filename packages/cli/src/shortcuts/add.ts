// `nimbo add <pkg...>`: packages.add over the command's WebSocket, the package manager's progress
// (packages.progress) on stderr as it comes, until packages.done; then each package added, `+ name@version`.
import type { EventEnvelope } from "@jsnb/core";
import { InvalidParams, packagesAdd } from "@jsnb/core";

import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import type { Shortcut } from "./shortcut.js";
import { readShortcut, withSession } from "./shortcut.js";

const help = `nimbo add <pkg...>: add packages to the workspace (packages.add)

Runs the workspace's package manager (the packages.manager setting, else the lockfile's) with name[@version] specs,
its output on stderr as it comes. There is no silent install: a cell that imports a missing package says so and
names this command.

Flags:
  --json   print packages.add's output ({ added }) as JSON
`;

/** The progress line of one of our names, or undefined for any other event. */
function progressOf(event: EventEnvelope, names: readonly string[]): string | undefined {
  if (event.type !== "packages.progress" || event.data.action !== "add") return undefined;
  const ours =
    event.data.names.length === names.length &&
    event.data.names.every((name, at) => name === names[at]);
  return ours ? event.data.line : undefined;
}

/** A daemon's INVALID_PARAMS about `names.<i>` named by the positional the user typed, `<pkg>` (not `names.0`). */
function positional(error: unknown): unknown {
  if (!(error instanceof InvalidParams)) return error;
  const issues = error.data.issues.map((issue) =>
    issue.path[0] === "names" ? { ...issue, path: ["<pkg>"] } : issue,
  );
  return new InvalidParams({ issues }, { cause: error });
}

async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  const args = readShortcut("add", argv, {}, { min: 1, max: Number.POSITIVE_INFINITY });
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  const names = [...args.positionals];
  const output = await withSession(io, { start: true, command: "add" }, async (session) => {
    const socket = session.socket();
    const progress = (event: EventEnvelope): void => {
      const line = progressOf(event, names);
      if (line !== undefined) io.stderr.write(line.endsWith("\n") ? line : `${line}\n`);
    };
    // A gap or a late error only costs progress lines; the answer still comes.
    const ignore = (): undefined => undefined;
    const subscription = await socket.subscribeWorkspace({
      onEvent: progress,
      onGap: ignore,
      onError: ignore,
    });
    try {
      return await socket.call(packagesAdd, { names });
    } catch (error) {
      throw positional(error);
    } finally {
      subscription.close();
    }
  });
  const added = output.added.map((pkg) => `+ ${pkg.name}@${pkg.version}\n`).join("");
  await write(io.stdout, args.json ? `${JSON.stringify(output)}\n` : added);
  return exitCodes.ok;
}

export const addShortcut: Shortcut = {
  name: "add",
  usage: "add <pkg...>",
  summary: "packages.add, with the package manager's progress",
  help,
  run,
};
