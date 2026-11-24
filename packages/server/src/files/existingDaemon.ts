// Discovery at start (03-api §7.1, 07-file-format §7): a server.json whose root is not this workspace (a copied workspace
// carries the original's file), whose pid is gone, or whose port does not answer workspace.info with the
// same startedAt and root, is stale and removed; a live one means a daemon already serves this workspace.
import { rm, stat } from "node:fs/promises";

import type { ServerFile } from "@jsnb/core";
import { JsnbError, parseServerFile } from "@jsnb/core";
import { z } from "zod";

import { isAlive, readServerText } from "./serverFile.js";

type Running = { readonly workspace: string; readonly pid: number; readonly port: number };
const runningMessage = ({ workspace, pid, port }: Running): string =>
  `A nimbo daemon (pid ${String(pid)}) already serves ${workspace} on 127.0.0.1:${String(port)}. Use it, or stop it with nimbo stop.`;

/** Another live daemon serves the workspace. */
export class DaemonRunning extends JsnbError {
  declare readonly data: Running;
  constructor(data: Running) {
    super({ name: "DaemonRunning", message: runningMessage(data), data });
  }
}

type Moved = Running & { readonly root: string };
const movedMessage = ({ workspace, pid, port, root }: Moved): string =>
  `A nimbo daemon (pid ${String(pid)}) on 127.0.0.1:${String(port)} still serves ${root}, which is gone (moved to ${workspace}, or deleted). It stops by itself within a few seconds: try again, or stop it with kill ${String(pid)}.`;

/** The daemon of a workspace folder that was moved or removed is still running. */
export class DaemonServingMovedFolder extends JsnbError {
  declare readonly data: Moved;
  constructor(data: Moved) {
    super({ name: "DaemonServingMovedFolder", message: movedMessage(data), data });
  }
}

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

/** The part of a workspace.info answer the probe reads. */
const InfoAnswer = z.looseObject({
  result: z.looseObject({ startedAt: z.string(), root: z.string().optional() }),
});

/** How long the probe of a recorded port may take before the file counts as stale. */
const probeMs = 2000;

/** Whether the daemon `file` describes answers workspace.info with its own startedAt. */
async function answers(file: ServerFile): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${String(file.port)}/rpc`, {
      method: "POST",
      headers: { authorization: `Bearer ${file.token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "workspace.info", params: {} }),
      signal: AbortSignal.timeout(probeMs),
    });
    const answer = InfoAnswer.safeParse(await response.json());
    const result = answer.data?.result;
    return result?.startedAt === file.startedAt && (result.root ?? file.root) === file.root;
  } catch {
    // Refused, timed out or not JSON: nothing of ours answers there, so the file is stale.
    return false;
  }
}

/**
 * The live daemon of `path`'s server.json for the workspace at `root` (its real path), or undefined: there is none, or
 * the file is stale or broken (another workspace's, a copy's) and is removed while it is still the one judged (a daemon
 * starting beside this one may write its own meanwhile, which stays).
 */
export async function liveDaemon(path: string, root: string): Promise<ServerFile | undefined> {
  const text = await readServerText(path);
  if (text === undefined) return undefined;
  const file = parseServerFile(text);
  const live = file !== undefined && isAlive(file.pid) && (await answers(file));
  if (live && file.root === root) return file;
  if (live && !(await exists(file.root))) {
    // The folder was moved or removed under a running daemon: the live one is its old owner, not a
    // stranger, and it stops by itself once it notices; a second daemon over the folder is the one thing not done.
    throw new DaemonServingMovedFolder({
      workspace: root,
      pid: file.pid,
      port: file.port,
      root: file.root,
    });
  }
  if ((await readServerText(path)) === text) await rm(path, { force: true });
  return undefined;
}
