// The daemon's own workspace services over a temporary folder (09-testing §8), for the tests that drive the workspace
// below the RPC layer (its notebooks table, its query engines): the built kernel, real files, a log that says nothing.
import { createIds } from "@jsnb/test-tools/ids";
import { kernelEntry } from "@jsnb/test-tools/kernel";
import type { Workspace as Folder } from "@jsnb/test-tools/workspace";

import { createEventBus } from "../events/bus.js";
import type { Log } from "../events/log.js";
import { prepareJsnbDir, resolveWorkspace } from "../files/workspaceDir.js";
import type { Workspace } from "../notebook/workspace/workspace.js";
import { openWorkspace } from "../notebook/workspace/workspace.js";

/** A log that drops every line. */
export const quiet: Log = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  child: () => quiet,
};

/** The workspace services of `folder`, as the daemon opens them; the test closes them. */
export async function openTestWorkspace(folder: Folder): Promise<Workspace> {
  const now = () => new Date();
  const root = await resolveWorkspace(folder.dir);
  return openWorkspace({
    facts: { root, serverVersion: "0.0.0", pid: process.pid, startedAt: "s" },
    ...{ jsnb: await prepareJsnbDir(root), userConfigDir: folder.path(".user") },
    ...{ bus: createEventBus(now), log: quiet, onEnvWrite: () => undefined },
    ...{ ids: createIds(1), now, port: () => 0, kernelEntry, redact: (text: string) => text },
  });
}
