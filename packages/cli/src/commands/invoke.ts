// One generated subcommand end to end (03-api §8): its flags read and checked, its help, the daemon found (or started,
// for a mutating command), the y/N of a destructive command on a terminal, the call over HTTP, its output printed and
// the exit code of its runs. `nimbo workspace stop` with no daemon has nothing to stop, as `nimbo stop`; a planned
// command is NOT_AVAILABLE from the registry, before any daemon.
import type { AnyCommand } from "@jsnb/core";
import { NotAvailable, workspaceStop } from "@jsnb/core";

import { openSession, startsDaemon } from "../daemon/session.js";
import { DaemonNotRunning, nothingToStop } from "../errors/daemon.js";
import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import { resultExit, resultText } from "../render/results.js";
import { beforeSession, completeInput, confirm } from "./complete.js";
import { commandHelp } from "./help.js";
import { wordsOf } from "./names.js";
import { parseCommandLine } from "./parse.js";

/** The call itself: the input completed, the y/N asked, the output printed. */
async function call(
  command: AnyCommand,
  line: Awaited<ReturnType<typeof parseCommandLine>>,
  io: Io,
): Promise<ExitCode> {
  const asked = await beforeSession(command, line.input, io);
  const session = await openSession(io, {
    start: startsDaemon(command),
    command: wordsOf(command),
  });
  try {
    const input = await completeInput(command, asked, session);
    if (command.tags.destructive && io.isTTY && !line.yes) await confirm(io, command);
    const output = await session.call(command, input);
    await write(io.stdout, resultText(command.name, output, line.json));
    return resultExit(command.name, output);
  } finally {
    session.close();
  }
}

/** Runs `nimbo <domain> <verb> <argv>`; rejects with the failure, which the caller reports. */
export async function runGenerated(
  command: AnyCommand,
  argv: readonly string[],
  io: Io,
): Promise<ExitCode> {
  const line = await parseCommandLine(command, argv, io);
  if (line.help) {
    await write(io.stdout, commandHelp(command));
    return exitCodes.ok;
  }
  // A planned command (v1.x) is answered from the registry: no daemon is sought, started or asked.
  if (command.tags.planned) throw new NotAvailable({ feature: command.name });
  try {
    return await call(command, line, io);
  } catch (error) {
    if (command !== workspaceStop || !(error instanceof DaemonNotRunning)) throw error;
    await write(io.stderr, nothingToStop(error.data.workspace));
    return exitCodes.ok;
  }
}
