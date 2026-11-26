// `nimbo serve`: the daemon in the foreground with its log on the terminal and no
// browser (daemon/foreground.ts); Ctrl-C stops it.
import { runForeground } from "../daemon/foreground.js";
import { findWorkspace } from "../daemon/workspace.js";
import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import type { Shortcut } from "./shortcut.js";
import { readShortcut } from "./shortcut.js";

const help = `nimbo serve: run the workspace's daemon in the foreground, its log on the terminal, no browser

Its log goes to the terminal as well as .jsnb/logs/daemon.log; Ctrl-C (SIGINT), SIGTERM, or closing the terminal
(SIGHUP) stops it cleanly.
Exits with the daemon's code: 0 after a clean stop, 1 when it could not start (another daemon serves the workspace,
the folder cannot be used), 2 for arguments it could not use. Its stderr comes through the CLI; a failure prints as
the CLI's own errors do.

Flags:
  --json   print the daemon's failure as one JSON line, { code, name, message, data }
`;

async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  const args = readShortcut("serve", argv, {}, { min: 0, max: 0 });
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  const workspace = await findWorkspace(io.cwd);
  return runForeground(io, workspace, { command: "serve", json: args.json, echoLog: true });
}

export const serveShortcut: Shortcut = {
  name: "serve",
  usage: "serve",
  summary: "run the daemon in the foreground, its log on the terminal",
  help,
  run,
};
