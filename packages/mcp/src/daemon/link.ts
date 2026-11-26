// One tool call's link to the workspace's daemon, found as the CLI finds it, the code written once more here since cli ↔ mcp is no edge: server.json read with core's schema, its
// pid alive, the daemon asked once for workspace.info answering with the file's startedAt (a dead pid, a refused port
// or another daemon there is no daemon), and its root the workspace's real path; one whose root is another folder (a
// workspace copied or moved with its .jsnb/) is not this workspace's: a mutating tool starts the
// workspace's own, any other is DaemonForeign. Calls go over HTTP, declared `client: "mcp"` with the agent's name.
import { realpath, stat } from "node:fs/promises";

import type { Caller, DaemonOptions } from "@jsnb/client";
import { createHttpClient, openingClosed } from "@jsnb/client";
import type { AnyCommand, ServerFile } from "@jsnb/core";
import { isJsnbError } from "@jsnb/core";

import { DaemonForeign, DaemonNotRunning, DaemonStartFailed } from "../errors/daemon.js";
import type { World } from "../io/world.js";
import { isAlive, readServerFile, serverFilePath } from "./serverFile.js";
import { startDaemon } from "./start.js";
import { findWorkspace } from "./workspace.js";

export type Link = {
  readonly workspace: string;
  /** True when this call started the daemon. */
  readonly started: boolean;
  /** A call over HTTP, with the client's retries. */
  readonly call: Caller;
};

export type LinkOptions = {
  /** May start a daemon (a mutating tool; a destructive one has nothing to act on without one). */
  readonly start: boolean;
  /** The tool's name, for the errors. */
  readonly command: string;
  /** The MCP client's name from its `initialize`, stamped in `meta.lastEdit.agent`; none when unknown. */
  readonly agent?: string | undefined;
};

/**
 * Whether finding no daemon starts one: mutating commands; a destructive one has nothing to act on, and a
 * planned one (v1.x) is answered NOT_AVAILABLE before any daemon is sought.
 */
export const startsDaemon = (command: AnyCommand): boolean =>
  command.tags.mutating && !command.tags.planned;

const optionsOf = (file: ServerFile, agent: string | undefined): DaemonOptions => ({
  url: `http://127.0.0.1:${String(file.port)}`,
  token: file.token,
  client: "mcp",
  ...(agent === undefined ? {} : { agent }),
});

/** How long the probe may wait by default, the server's own probe's time; a silent listener is no daemon. */
const probeMs = 2000;

/** Whether the daemon `file` names answers, once and within `waitMs`, as itself (its own start time). */
async function answers(file: ServerFile, waitMs: number): Promise<boolean> {
  try {
    const client = createHttpClient({ ...optionsOf(file, undefined), retry: { attempts: 1 } });
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
    // ENOENT, ENOTDIR, EACCES: nothing there that can be called a folder.
    return false;
  }
}

/** What server.json leads to: the workspace's own live daemon, another folder's (`foreign`), or none. */
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

/** What the server says on stderr while it waits out the old daemon, so the pause has its reason. */
const movedWaitLine =
  "Waiting for the daemon this folder had before it was moved to stop by itself, then starting its own…\n";

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Starts the workspace's daemon; when the start meets the daemon of this folder before it was moved, which the server
 * refuses (DaemonServingMovedFolder) until that daemon stops by itself, the start is tried once more after the wait.
 */
async function startOrRetry(world: World, workspace: string, command: string): Promise<void> {
  try {
    await startDaemon(world, workspace, command);
  } catch (error) {
    if (!(error instanceof DaemonStartFailed) || error.data.reason !== "DaemonServingMovedFolder")
      throw error;
    world.stderr.write(movedWaitLine);
    await (world.movedRetryWait ?? (() => pause(movedRetryMs)))();
    await startDaemon(world, workspace, command);
  }
}

/**
 * The daemon of `workspace`. With none, or another folder's, a tool that may start one starts the workspace's own;
 * any other is DaemonNotRunning, or DaemonForeign naming both folders, and the other folder's daemon is sent nothing.
 */
async function reach(world: World, workspace: string, options: LinkOptions) {
  const found = await liveDaemon(workspace, world.daemonProbeMs ?? probeMs);
  if (found.kind === "own") return { file: found.file, started: false };
  if (!options.start) {
    if (found.kind === "none") throw new DaemonNotRunning({ workspace });
    const { root, pid } = found.file;
    const serverFile = serverFilePath(workspace);
    throw new DaemonForeign({ workspace, root, serverFile, pid, gone: found.gone });
  }
  await startOrRetry(world, workspace, options.command);
  const fresh = await readServerFile(workspace);
  if (fresh === undefined) throw new DaemonNotRunning({ workspace });
  return { file: fresh, started: true };
}

/** Links one tool call to its workspace's daemon, found from the working folder at the time of the call. */
export async function linkDaemon(world: World, options: LinkOptions): Promise<Link> {
  const workspace = await findWorkspace(world.cwd());
  const { file, started } = await reach(world, workspace, options);
  return {
    workspace,
    started,
    call: openingClosed(createHttpClient(optionsOf(file, options.agent)).call),
  };
}
