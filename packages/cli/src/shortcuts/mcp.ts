// `nimbo mcp` (03-api §8, §9): the MCP server on the CLI's own stdio, for an agent's configuration
// (`claude mcp add nimbo -- nimbo mcp`). Its process entry is `@jsnb/mcp/main` resolved at run time, never imported (as
// the daemon's is), run with the CLI's stdin, stdout and stderr and in its working folder, from which it
// finds the workspace; SIGINT, SIGTERM and SIGHUP are passed on, and the CLI exits with its code.
import { fileURLToPath } from "node:url";

import { productName } from "@jsnb/core";

import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import type { Io, SignalName } from "../io/io.js";
import { write } from "../io/io.js";
import type { Shortcut } from "./shortcut.js";
import { readShortcut } from "./shortcut.js";
import { mcpInstall } from "./mcpInstall.js";

const help = `nimbo mcp: run the MCP server on stdio

Serves the nimbo API to an agent over the Model Context Protocol: one tool per command (cell.run is cell_run), and
the resources nimbo://notebook/<path> and nimbo://cell/<path>/<id>. It finds the workspace's daemon as every command
does, and the tools that change something start it. Configure it once per project, for example:
  claude mcp add nimbo -- nimbo mcp
It ends when the agent closes its input. stdout carries the protocol alone.

${productName} mcp install registers it with the agents found on this machine (see ${productName} mcp install --help).
`;

/** The MCP server's own entry, `dist/main.js` of `@jsnb/mcp`, as Node resolves it from here. */
const mcpEntry = (): string => fileURLToPath(import.meta.resolve("@jsnb/mcp/main"));

const serverCodes: readonly ExitCode[] = [0, 1];

/** The MCP server's exit code as the CLI's; a server killed by a signal is 1. */
const exitOf = (code: number | null): ExitCode =>
  serverCodes.find((known) => known === code) ?? exitCodes.runError;

async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  if (argv[0] === "install") return mcpInstall(argv.slice(1), io);
  const args = readShortcut("mcp", argv, {}, { min: 0, max: 0 });
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  const child = io.spawn(io.execPath, [mcpEntry()], {
    cwd: io.cwd,
    env: { ...io.env },
    stdio: "inherit",
  });
  const forward = (signal: SignalName) => () => {
    child.kill(signal);
  };
  const removals = (["SIGINT", "SIGTERM", "SIGHUP"] as const).map((signal) =>
    io.onSignal(signal, forward(signal)),
  );
  try {
    return await new Promise<ExitCode>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => {
        resolve(exitOf(code));
      });
    });
  } finally {
    for (const remove of removals) remove();
  }
}

export const mcpShortcut: Shortcut = {
  name: "mcp",
  usage: "mcp [install]",
  summary: "run the MCP server on stdio (for an agent)",
  help,
  run,
};
