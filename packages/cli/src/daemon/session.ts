// One command's link to the workspace's daemon (03-api §7.1, §7.3, §8): server.json read and the daemon it names
// asked once for workspace.info (a dead pid, a refused port or another daemon there is no daemon); one whose root is
// another folder (a workspace copied with its .jsnb/) is not this workspace's: a mutating command starts the
// workspace's own, any other is DaemonForeign. HTTP for calls and a WebSocket only for what needs events, both
// declared `client: "cli"`; the socket reports stray errors to stderr and gives up after a few reconnects.
import { realpath, stat } from "node:fs/promises";

import type { Caller, Client, DaemonOptions, SocketClient } from "@jsnb/client";
import { connectSocket, createHttpClient, openingClosed } from "@jsnb/client";
import type { AnyCommand, ServerFile } from "@jsnb/core";
import { isJsnbError } from "@jsnb/core";

import { DaemonForeign, DaemonNotRunning, DaemonStartFailed } from "../errors/daemon.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import { isAlive, readServerFile, serverFilePath } from "./serverFile.js";
import { startDaemon } from "./start.js";
import { findWorkspace } from "./workspace.js";

/** How many sockets one outage may open before it ends with DaemonUnreachable (two waits, 0.75 s). */
const reconnectAttempts = 2;

export type Session = {
  readonly workspace: string;
  /** The folder the daemon serves, as its server.json names it: the workspace's real path. */
  readonly root: string;
  readonly daemon: DaemonOptions;
  /** True when this command started the daemon. */
  readonly started: boolean;
  /** A call over HTTP (03-api §7.3), with the client's retries; a closed notebook it names is opened first. */
  readonly call: Caller;
  /** The command's one WebSocket, opened on first use and closed by close(). */
  readonly socket: () => SocketClient;
  readonly close: () => void;
};

/**
 * Whether finding no daemon starts one: mutating commands (03-api §8); a destructive one has nothing to act on, and a
 * planned one (v1.x) is answered NOT_AVAILABLE before any daemon is sought.
 */
export const startsDaemon = (command: AnyCommand): boolean =>
  command.tags.mutating && !command.tags.planned;

const optionsOf = (file: ServerFile): DaemonOptions => ({
  url: `http://127.0.0.1:${String(file.port)}`,
  token: file.token,
  client: "cli",
});

/** How long the probe may wait by default, the server's own probe's time; a silent listener is no daemon. */
const probeMs = 2000;

/** Whether the daemon `file` names answers, once and within `waitMs`, as itself (its own start time). */
async function answers(file: ServerFile, waitMs: number): Promise<boolean> {
  try {
    const client = createHttpClient({ ...optionsOf(file), retry: { attempts: 1 } });
    const signal = AbortSignal.timeout(waitMs);
    return (await client.workspace.info({}, { signal })).startedAt === file.startedAt;
  } catch (error) {
    // Refused, not ours (a wrong token, an answer that is not the API): no daemon of this workspace is there.
    if (isJsnbError(error)) return false;
    throw error;
  }
}

/** Whether two paths are one folder: their real paths (macOS's /var is /private/var); a folder gone is no match. */
async function sameFolder(a: string, b: string): Promise<boolean> {
  try {
    return (await realpath(a)) === (await realpath(b));
  } catch {
    // One of them does not exist (or cannot be read): it cannot be the other; liveDaemon tells a gone root apart.
    return false;
  }
}

/** Whether `path` exists, for a daemon's root that may have been moved or deleted. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    // ENOENT, ENOTDIR, EACCES: nothing there that the CLI can call a folder.
    return false;
  }
}

/**
 * What server.json leads to: the workspace's own live daemon; another folder's (`foreign`: the workspace was copied
 * with its .jsnb/ while that daemon ran); or none (no file, a dead pid, no answer).
 */
type Found =
  | { readonly kind: "own"; readonly file: ServerFile }
  | { readonly kind: "foreign"; readonly file: ServerFile; readonly gone: boolean }
  | { readonly kind: "none" };

async function liveDaemon(workspace: string, waitMs: number): Promise<Found> {
  const file = await readServerFile(workspace);
  if (file === undefined || !isAlive(file.pid) || !(await answers(file, waitMs)))
    return { kind: "none" };
  if (await sameFolder(file.root, workspace)) return { kind: "own", file };
  return { kind: "foreign", file, gone: !(await exists(file.root)) };
}

/**
 * How long a start waits before its one retry when the daemon of a moved folder refused it: that daemon
 * checks its folder every 2 s by default and stops once it is gone, so 3 s outlast its check.
 */
const movedRetryMs = 3000;

/** What the CLI says while it waits out the old daemon, so the pause has its reason. */
const movedWaitLine =
  "Waiting for the daemon this folder had before it was moved to stop by itself, then starting its own…\n";

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Starts the workspace's daemon; when the start meets the daemon of this folder before it was moved, which the server
 * refuses (DaemonServingMovedFolder) until that daemon stops by itself, the start is tried once more after the wait.
 * A second refusal is DaemonStartFailed (exit 3) with the server's words: it stops within seconds, or kill its pid.
 */
async function startOrRetry(io: Io, workspace: string, command: string): Promise<void> {
  try {
    await startDaemon(io, workspace, command);
  } catch (error) {
    if (!(error instanceof DaemonStartFailed) || error.data.reason !== "DaemonServingMovedFolder")
      throw error;
    await write(io.stderr, movedWaitLine);
    await (io.movedRetryWait ?? (() => pause(movedRetryMs)))();
    await startDaemon(io, workspace, command);
  }
}

export type SessionOptions = {
  /** May start a daemon (a mutating command; a destructive one has nothing to act on without one). */
  readonly start: boolean;
  /** The command's words, for the errors' help line. */
  readonly command: string;
};

/**
 * The daemon of `workspace`. With none, or another folder's, a command that may start one starts the workspace's own
 * (the server takes a copy's file as stale and replaces it, and waits out a moved folder's old daemon); any other is
 * DaemonNotRunning, or DaemonForeign naming both folders (and whether the other one is gone), and nothing is sent to
 * the other folder's daemon.
 */
async function reach(io: Io, workspace: string, options: SessionOptions) {
  const waitMs = io.daemonProbeMs ?? probeMs;
  const found = await liveDaemon(workspace, waitMs);
  if (found.kind === "own") return { file: found.file, started: false };
  if (!options.start) {
    if (found.kind === "none") throw new DaemonNotRunning({ workspace });
    const { root, pid } = found.file;
    const serverFile = serverFilePath(workspace);
    throw new DaemonForeign({ workspace, root, serverFile, pid, gone: found.gone });
  }
  await startOrRetry(io, workspace, options.command);
  const fresh = await readServerFile(workspace);
  if (fresh === undefined) throw new DaemonNotRunning({ workspace });
  return { file: fresh, started: true };
}

const stderrReport = (io: Io) => (error: unknown) => {
  io.stderr.write(`${isJsnbError(error) ? `${error.name}: ${error.message}` : String(error)}\n`);
};

/** Links one command to its workspace's daemon. */
export async function openSession(io: Io, options: SessionOptions): Promise<Session> {
  const workspace = await findWorkspace(io.cwd);
  const { file, started } = await reach(io, workspace, options);
  const daemon = optionsOf(file);
  const http: Client = createHttpClient(daemon);
  let socket: SocketClient | undefined;
  return {
    workspace,
    root: file.root,
    daemon,
    started,
    call: openingClosed(http.call),
    socket: () =>
      (socket ??= connectSocket({
        ...daemon,
        reportError: stderrReport(io),
        reconnect: { attempts: reconnectAttempts },
      })),
    close: () => {
      socket?.close();
    },
  };
}
