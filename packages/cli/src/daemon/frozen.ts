// A daemon that server.json names, whose process lives but does not answer: the probe counts it as no daemon,
// `nimbo stop` must not (`@jsnb/client/node` checks the pid is this workspace's daemon and ends it).
import type { ServerFile } from "@jsnb/core";
import { isOwnDaemon } from "@jsnb/client/node";

import { isAlive, readServerFile } from "./serverFile.js";

/** The server.json of a daemon of `workspace` that lives but did not answer the probe, or undefined. */
export async function silentDaemon(workspace: string): Promise<ServerFile | undefined> {
  const file = await readServerFile(workspace).catch(() => undefined);
  if (file === undefined || !isAlive(file.pid)) return undefined;
  return (await isOwnDaemon(file, workspace)) ? file : undefined;
}
