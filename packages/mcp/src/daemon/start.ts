// Starting the daemon for a mutating tool (03-api §8 and §9, 02-architecture §7), as the CLI starts it: `<node> <entry>
// --workspace <ws>` detached, its stdout read until the `{"event":"listening"}` line, then let go; its stderr goes to a
// file of its own (then `.jsnb/logs/stderr.log`, startFolder.ts), so no later write of the daemon meets a pipe the MCP
// server closed, and none is lost. An entry that exits first reports the JSON line it wrote there, and `DaemonRunning`
// (another starter won the race) means a daemon is there to use.
import type { ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

import { z } from "zod";

import { DaemonStartFailed, silentStart } from "../errors/daemon.js";
import type { World } from "../io/world.js";
import { daemonEntry } from "./entry.js";
import { stderrFile } from "./startFolder.js";

/** How long a start may stay silent before the MCP server stops it (a hang guard; a start takes well under 2 s). */
const startTimeoutMs = 60_000;

type Ended = {
  readonly code: number | null;
  readonly signal: string | null;
  readonly silent: boolean;
  readonly error?: Error;
};
type Outcome = { readonly listening: true } | ({ readonly listening: false } & Ended);

const Listening = z.looseObject({ event: z.literal("listening") });
const Failure = z.looseObject({ name: z.string(), message: z.string() });

/** A JSON line read with `schema`, or undefined (not JSON, or another shape). */
function lineOf<T>(schema: z.ZodType<T>, line: string): T | undefined {
  try {
    const parsed = schema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : undefined;
  } catch {
    // Not JSON (a crash's stack, a warning): not the line looked for.
    return undefined;
  }
}

/** Settles at the listening line, or when the entry ends (or cannot start, or stays silent past the guard). */
function watch(child: ChildProcess): Promise<Outcome> {
  return new Promise((resolve) => {
    let silent = false;
    const timer = setTimeout(() => {
      silent = true;
      child.kill("SIGKILL");
    }, startTimeoutMs);
    const settle = (outcome: Outcome): void => {
      clearTimeout(timer);
      resolve(outcome);
    };
    if (child.stdout) {
      createInterface({ input: child.stdout }).on("line", (line) => {
        if (lineOf(Listening, line) !== undefined) settle({ listening: true });
      });
    }
    child.once("close", (code: number | null, signal: string | null) => {
      settle({ listening: false, code, signal, silent });
    });
    child.once("error", (error) => {
      settle({ listening: false, code: null, signal: null, silent, error });
    });
  });
}

/** Why the start failed, from the entry's last stderr line or how it ended. */
function failure(outcome: Ended, workspace: string, stderr: string) {
  const said = lineOf(Failure, stderr.trim().split("\n").at(-1) ?? "");
  const reason = outcome.silent ? "DaemonSilent" : (said?.name ?? "DaemonExited");
  const data = { workspace, reason, exitCode: outcome.code, signal: outcome.signal };
  const message = outcome.silent
    ? silentStart(startTimeoutMs / 1000)
    : (said?.message ?? outcome.error?.message);
  return { said, error: new DaemonStartFailed(data, message, { cause: outcome.error }) };
}

/** Starts the workspace's daemon and resolves once one listens (this one, or the one that won a race to start). */
export async function startDaemon(world: World, workspace: string, command: string): Promise<void> {
  const entry = await daemonEntry(world.env, command);
  const stderr = await stderrFile(workspace);
  const child = world.spawn(world.execPath, [entry, "--workspace", workspace], {
    cwd: workspace,
    env: { ...world.env },
    detached: true,
    windowsHide: true,
    stdio: ["ignore", "pipe", stderr.fd],
  });
  const watching = watch(child); // listening before any await: a spawn that fails says so on the next tick
  stderr.record(child.pid); // at once: a server killed from here on leaves its daemon's pid for the next start's sweep
  await stderr.close(); // the daemon holds its own copy
  const outcome = await watching;
  if (outcome.listening) {
    child.stdout?.destroy(); // the daemon writes nothing more there (its one line is read)
    child.unref();
    await stderr.keep();
    return;
  }
  try {
    const { said, error } = failure(outcome, workspace, await stderr.read());
    if (said?.name !== "DaemonRunning") throw error;
  } finally {
    await stderr.remove();
  }
}
