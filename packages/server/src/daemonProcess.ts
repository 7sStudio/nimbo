// The daemon as a process (02-architecture §7: `nimbo open` and `nimbo serve` fork it): its arguments, the start, one
// JSON line on stdout once it listens, the clean stop of workspace.stop on SIGINT, SIGTERM or SIGHUP, and the exit
// code: 0 after a clean stop, 1 when the start failed (one JSON line `{ name, message, data }` on stderr), 2 for
// arguments it cannot use. src/main.ts runs it against the real process.
import { parseArgs } from "node:util";

import { isJsnbError } from "@jsnb/core";

import type { LogLevel } from "./files/logs/logger.js";
import type { ServerOptions } from "./options.js";
import type { RunningServer } from "./server.js";
import { startServer } from "./server.js";

/** The parts of `process` the daemon uses, so a test can stand in for it. */
/** A stream of the host; `on` is the real process's, so a dead pipe's EPIPE can be swallowed. */
type HostStream = {
  readonly write: (text: string) => unknown;
  readonly on?: (event: "error", listener: (error: Error) => void) => unknown;
};

type DaemonHost = {
  readonly cwd: () => string;
  readonly once: (signal: "SIGINT" | "SIGTERM" | "SIGHUP", listener: () => void) => unknown;
  readonly stdout: HostStream;
  readonly stderr: HostStream;
};

const guarded = new WeakSet<HostStream>();

/**
 * Writes one line to the parent; a parent that died before reading it (a CLI killed between the daemon's start and its
 * listening line) makes the write fail with EPIPE, which must not end a daemon meant to outlive it.
 */
function tell(stream: HostStream, text: string): void {
  if (!guarded.has(stream)) {
    guarded.add(stream);
    stream.on?.("error", () => undefined);
  }
  stream.write(text);
}

const levels: readonly LogLevel[] = ["error", "warn", "info", "debug"];

const usage =
  "usage: nimbo daemon [--workspace <dir>] [--port <n>] [--ui <dir>] [--user-config <dir>] [--log-level <level>] [--foreground]";

type Parsed =
  | { readonly ok: true; readonly options: ServerOptions }
  | { readonly ok: false; readonly reason: string };

const spec = {
  workspace: { type: "string" },
  port: { type: "string" },
  ui: { type: "string" },
  "user-config": { type: "string" },
  "log-level": { type: "string" },
  foreground: { type: "boolean" },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof spec }>>["values"];

/** `--port`, a whole number from 0 to 65535 (0 when absent), or undefined. */
function portOf(value: string | undefined): number | undefined {
  const port = value === undefined ? 0 : Number(value);
  return Number.isInteger(port) && port >= 0 && port <= 65_535 ? port : undefined;
}

function optionsOf(values: Values, cwd: string): Parsed {
  const port = portOf(values.port);
  if (port === undefined)
    return { ok: false, reason: `--port ${String(values.port)} is not a port` };
  const level = levels.find((known) => known === values["log-level"]);
  if (values["log-level"] !== undefined && level === undefined) {
    return { ok: false, reason: `--log-level is one of ${levels.join(", ")}` };
  }
  const options: ServerOptions = {
    workspace: values.workspace ?? cwd,
    port,
    ...(values.ui === undefined ? {} : { uiDir: values.ui }),
    ...(values["user-config"] === undefined ? {} : { userConfigDir: values["user-config"] }),
    ...(level === undefined ? {} : { logLevel: level }),
    logToStderr: values.foreground === true,
  };
  return { ok: true, options };
}

/** The options of `argv`, or the reason they cannot be used. */
function parseDaemonArgs(argv: readonly string[], cwd: string): Parsed {
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: spec,
      strict: true,
      allowPositionals: false,
    });
    return optionsOf(values, cwd);
  } catch (error) {
    // parseArgs throws a TypeError naming the unknown option or the missing value: that is the reason to show.
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

/** The failure as one JSON line: a JsnbError's name, message and data, anything else's name and message. */
const failureLine = (error: unknown): string =>
  isJsnbError(error)
    ? line({ name: error.name, message: error.message, data: error.data })
    : line({ name: error instanceof Error ? error.name : "Error", message: String(error) });

/** Runs the daemon until it stops; resolves with the process's exit code. */
export async function runDaemon(argv: readonly string[], host: DaemonHost): Promise<number> {
  const parsed = parseDaemonArgs(argv, host.cwd());
  if (!parsed.ok) {
    tell(host.stderr, line({ name: "InvalidArguments", message: `${parsed.reason}\n${usage}` }));
    return 2;
  }
  let server: RunningServer;
  try {
    server = await startServer(parsed.options);
  } catch (error) {
    tell(host.stderr, failureLine(error));
    return 1;
  }
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    host.once(signal, () => void server.stop());
  }
  tell(
    host.stdout,
    line({ event: "listening", url: server.url, port: server.port, workspace: server.workspace }),
  );
  await server.closed;
  return 0;
}
