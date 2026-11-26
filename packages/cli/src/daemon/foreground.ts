// The daemon in the terminal's foreground, for `nimbo open` and `nimbo serve`: its entry
// forked in its own process group, SIGINT, SIGTERM and SIGHUP (a closed terminal) passed on to it as they come, so
// Ctrl-C stops it cleanly (notebooks saved) and a second Ctrl-C ends it at once; the CLI exits with its code (0 after a
// clean stop, 1 when it could not start, 2 for arguments it could not use). Its stderr comes through the CLI line by
// line, its failure line read as a CLI error; `listening` hears its one stdout line once it serves.
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

import { z } from "zod";

import { OutputClosed } from "../errors/cli.js";
import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import { colourOn, painter } from "../io/colour.js";
import type { Io, SignalName } from "../io/io.js";
import { write } from "../io/io.js";
import { daemonEntry } from "./entry.js";
import type { LineStyle } from "./logLine.js";
import { logLineText } from "./logLine.js";
import { uiArguments } from "./ui.js";

const daemonCodes: readonly ExitCode[] = [0, 1, 2, 3, 4];

/** The daemon's failure line (`{ name, message, data }`, its last word when it cannot start), not a log line. */
const Failure = z.looseObject({ name: z.string(), message: z.string() });
const Listening = z.looseObject({ event: z.literal("listening") });

const parsed = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return undefined; // a log line or a stack: the daemon's own words
  }
};

type Relayed = { failed: boolean };

/**
 * One line of the daemon's stderr as the CLI prints it: a log line as one readable line (as it is under --json), a
 * failure as the CLI prints its own (`Name: message`, or under --json the `{ code, name, message, data }` line),
 * anything else (a stack) as it is.
 */
function lineText(line: string, asJson: boolean, relayed: Relayed, style: LineStyle): string {
  const value = parsed(line);
  const isLog = typeof value === "object" && value !== null && "level" in value;
  if (isLog) return asJson ? `${line}\n` : logLineText(value, style);
  const failure = Failure.safeParse(value);
  if (!failure.success) return `${line}\n`;
  relayed.failed = true;
  const { name, message } = failure.data;
  return asJson
    ? `${JSON.stringify({ code: null, name, message, data: failure.data.data ?? {} })}\n`
    : `${name}: ${message}\n`;
}

/**
 * Copies the daemon's stderr to the CLI's line by line; resolves at its end. Once the CLI's stderr has gone (`| head`),
 * the daemon's is still read to its end, so its pipe never fills.
 */
async function relay(
  io: Pick<Io, "stderr">,
  stderr: Readable | null,
  how: { readonly asJson: boolean; readonly relayed: Relayed; readonly style: LineStyle },
): Promise<void> {
  if (stderr === null) return;
  let open = true;
  for await (const line of createInterface({
    input: stderr,
    crlfDelay: Number.POSITIVE_INFINITY,
  })) {
    if (!open) continue;
    try {
      await write(io.stderr, lineText(line, how.asJson, how.relayed, how.style));
    } catch (error) {
      if (!(error instanceof OutputClosed)) throw error;
      open = false;
    }
  }
}

/** Calls `listening` once, at the daemon's `{"event":"listening"}` line on its stdout. */
function hearListening(stdout: Readable | null, listening: () => Promise<void>): Promise<void> {
  if (stdout === null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const lines = createInterface({ input: stdout });
    lines.on("line", (line) => {
      if (!Listening.safeParse(parsed(line)).success) return;
      lines.close();
      listening().then(resolve, reject);
    });
    lines.once("close", resolve);
  });
}

const lineStyle = (io: Io, asJson: boolean): LineStyle => {
  const home = io.platform === "win32" ? undefined : io.env.HOME;
  return {
    paint: painter(!asJson && colourOn(io, "stderr")),
    ...(home === undefined ? {} : { home }),
  };
};

/** The daemon's exit code as the CLI's; a daemon killed by a signal is 1. */
const exitOf = (code: number | null): ExitCode =>
  daemonCodes.find((known) => known === code) ?? exitCodes.runError;

export type Foreground = {
  /** The command's words, for the errors' help line. */
  readonly command: string;
  readonly json: boolean;
  /** `nimbo serve`: the daemon's stdout is the terminal's. */
  readonly echoLog: boolean;
  /** Once the daemon serves (its stdout read for it; with echoLog it is never called). */
  readonly listening?: () => Promise<void>;
  /** At each signal passed on, before the daemon hears it. */
  readonly stopping?: (signal: SignalName) => void;
};

/** The daemon forked for the foreground: in its own process group on POSIX, so a terminal's Ctrl-C reaches the CLI
 * alone and the daemon hears it once, from it. */
async function spawnDaemon(io: Io, workspace: string, how: Foreground) {
  const entry = await daemonEntry(io.env, how.command);
  const ui = await uiArguments(io.env, how.command);
  return io.spawn(io.execPath, [entry, "--workspace", workspace, "--foreground", ...ui], {
    cwd: workspace,
    env: { ...io.env },
    stdio: ["ignore", how.echoLog ? "inherit" : "pipe", "pipe"],
    detached: io.platform !== "win32",
  });
}

// A crash or a kill leaves no failure line, so the CLI says how the daemon ended.
async function unexpectedEnd(
  io: Pick<Io, "stderr">,
  exit: {
    readonly code: number | null;
    readonly signal: string | null;
    readonly asJson: boolean;
    readonly style: LineStyle;
  },
): Promise<void> {
  const how = exit.signal === null ? { code: exit.code } : { signal: exit.signal };
  const entry = {
    level: "error",
    time: new Date().toISOString(),
    msg: "the daemon exited",
    ...how,
  };
  try {
    await write(
      io.stderr,
      exit.asJson ? `${JSON.stringify(entry)}\n` : logLineText(entry, exit.style),
    );
  } catch (error) {
    if (!(error instanceof OutputClosed)) throw error;
  }
}

const exited = (child: Awaited<ReturnType<typeof spawnDaemon>>) =>
  new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });

/** Runs the workspace's daemon in the foreground until it exits; its exit code. */
export async function runForeground(io: Io, workspace: string, how: Foreground): Promise<ExitCode> {
  const child = await spawnDaemon(io, workspace, how);
  const asked = { stop: false };
  const forward = (signal: SignalName) => () => {
    asked.stop = true;
    how.stopping?.(signal);
    child.kill(signal);
  };
  const removals = (["SIGINT", "SIGTERM", "SIGHUP"] as const).map((signal) =>
    io.onSignal(signal, forward(signal)),
  );
  const outcome = { failed: false };
  try {
    const said: Relayed = { failed: false };
    const style = lineStyle(io, how.json);
    const relayed = relay(io, child.stderr, { asJson: how.json, relayed: said, style });
    // the page could not be opened once the daemon served: said, and the daemon stopped as Ctrl-C would
    const heard = (
      how.listening ? hearListening(child.stdout, how.listening) : Promise.resolve()
    ).catch(async (error: unknown) => {
      await write(
        io.stderr,
        `${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`,
      );
      child.kill("SIGINT");
      outcome.failed = true;
    });
    const exit = await exited(child);
    const code = exitOf(exit.code);
    await Promise.all([relayed, heard]);
    if (!asked.stop && !said.failed && code !== exitCodes.ok)
      await unexpectedEnd(io, { ...exit, asJson: how.json, style });
    return outcome.failed ? exitCodes.runError : code;
  } finally {
    for (const remove of removals) remove();
  }
}
