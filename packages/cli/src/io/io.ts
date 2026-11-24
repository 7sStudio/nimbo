// The world `run` talks to: its streams, environment and working folder, and the effects a test injects (spawning a
// process, opening a browser, signals, the clock), so every command runs in-process against a real daemon; and the
// write that waits for each chunk and turns a reader gone (`| head`) into OutputClosed.
import type { ChildProcess, SpawnOptions } from "node:child_process";
import type { Readable, Writable } from "node:stream";

import { OutputClosed } from "../errors/cli.js";

/** Starts a process: the daemon's entry, `nimbo serve`'s foreground daemon, the platform's browser opener. */
export type Spawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

/** Asks the platform to open `url` in the browser; true once it did, false when no opener ran or it failed. */
export type Opener = (url: string) => Promise<boolean>;

export type SignalName = "SIGINT" | "SIGTERM" | "SIGHUP";

export type Io = {
  readonly stdin: Readable;
  readonly stdout: Writable;
  readonly stderr: Writable;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  /** stdin is a terminal: destructive commands ask first and a secret is asked for. */
  readonly isTTY: boolean;
  /** stdout is a terminal: `--full` ends its line there, so the prompt does not join the JSON. */
  readonly outputIsTTY?: boolean;
  /** stderr is a terminal: the foreground daemon's log lines are coloured there. */
  readonly errorIsTTY?: boolean;
  /** How long the daemon server.json names may take to answer before it counts as none (2 s, as the server's own). */
  readonly daemonProbeMs?: number;
  /**
   * The wait before the one retry of a start that met the daemon of a moved folder, which stops by itself once its root
   * check sees the folder gone (3 s by default); a test waits on that daemon's stop instead.
   */
  readonly movedRetryWait?: () => Promise<void>;
  readonly platform: NodeJS.Platform;
  /** The Node that runs the CLI, which runs the daemon's entry too. */
  readonly execPath: string;
  readonly spawn: Spawn;
  /** Opens a URL in the browser; the platform's opener through `spawn` when left out. */
  readonly openUrl?: Opener;
  /** Calls `listener` on each `signal`; returns its removal. */
  readonly onSignal: (signal: SignalName, listener: () => void) => () => void;
  readonly now: () => Date;
};

/**
 * The codes of a stream whose reader is gone or that is closed already. ECANCELED: Node destroys a child's stdin as it
 * handles that child's exit, cancelling a write still in flight; ENOTCONN: `stdio: "pipe"` is a socket pair, and a
 * write to one whose peer is closing can fail so under load. Both mean what EPIPE means.
 */
const goneCodes = new Set([
  "EPIPE",
  "ECANCELED",
  "ENOTCONN",
  "ERR_STREAM_DESTROYED",
  "ERR_STREAM_WRITE_AFTER_END",
  "ECONNRESET",
]);

const codeOf = (error: unknown): string =>
  error instanceof Error ? String(Reflect.get(error, "code") ?? "") : "";

/** OutputClosed for a reader that went away, else the error itself. */
const closedOr = (error: Error): Error =>
  goneCodes.has(codeOf(error))
    ? new OutputClosed({ code: codeOf(error) }, { cause: error })
    : error;

/**
 * Keeps a stream's later failures from being an uncaught `error` event (a reader that goes away after the last write
 * was handed over): `write` reports the ones that matter, through each write's callback.
 */
export function guard(stream: Writable): void {
  if (stream.listenerCount("error") === 0) {
    stream.on("error", () => undefined); // the failing write's callback carries it; nothing else needs the event
  }
}

/** Writes a chunk and waits until the stream took it; rejects with OutputClosed once its reader is gone. */
export function write(stream: Writable, text: string | Uint8Array): Promise<void> {
  if (stream.destroyed || stream.writableEnded) {
    return Promise.reject(new OutputClosed({ code: "ERR_STREAM_DESTROYED" }));
  }
  return new Promise((resolve, reject) => {
    stream.write(text, (error) => {
      if (error) reject(closedOr(error));
      else resolve();
    });
  });
}
