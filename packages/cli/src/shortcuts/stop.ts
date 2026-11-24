// `nimbo stop` (03-api §8): workspace.stop. With no daemon running there is nothing to stop, which is what the user
// asked for, so it says so and exits 0 instead of 3; it starts no daemon and asks no question (its name is the intent).
import { productVersion, workspaceStop } from "@jsnb/core";

import { readServerFile } from "../daemon/serverFile.js";

import { DaemonNotRunning, nothingToStop } from "../errors/daemon.js";
import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import { findInstallation } from "../install/installation.js";
import { lockHolder, withLock } from "../install/lock.js";
import { sweepVersions } from "../install/local.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import type { Shortcut } from "./shortcut.js";
import { readShortcut, withSession } from "./shortcut.js";

const help = `nimbo stop: stop the workspace's daemon (workspace.stop)

Closes every notebook and stops the daemon. With no daemon running it says so and exits 0.

Flags:
  --json   print { stopped, workspace } as JSON
`;

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * After a daemon of an older installed version stopped (02-architecture §10): once its process is gone (10 s at most),
 * the versions nothing runs from any more are removed, as an upgrade leaves them for then.
 */
async function sweepAfter(
  daemon: { readonly pid: number; readonly version: string },
  io: Io,
): Promise<void> {
  if (daemon.version === productVersion) return;
  const installation = await findInstallation();
  if (installation.method !== "installer" || installation.dataDir === undefined) return;
  for (let waited = 0; waited < 10_000 && alive(daemon.pid); waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const { dataDir } = installation;
  // Another install or upgrade holding the lock sweeps itself; this one leaves the versions to it.
  if ((await lockHolder(dataDir)) !== undefined) return;
  const sweep = await withLock(dataDir, () => sweepVersions(dataDir, productVersion)).catch(() => ({
    removed: [],
  }));
  for (const version of sweep.removed)
    await write(io.stderr, `Removed ${version}: nothing runs from it any more.\n`);
}

async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  const args = readShortcut("stop", argv, {}, { min: 0, max: 0 });
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  try {
    const workspace = await withSession(io, { start: false, command: "stop" }, async (session) => {
      const daemon = await readServerFile(session.workspace);
      await session.call(workspaceStop, {});
      if (daemon !== undefined) await sweepAfter(daemon, io);
      return session.root; // the folder the stopped daemon served, as it names it
    });
    await write(
      io.stdout,
      args.json
        ? `${JSON.stringify({ stopped: true, workspace })}\n`
        : `Stopped the daemon for ${workspace}.\n`,
    );
  } catch (error) {
    if (!(error instanceof DaemonNotRunning)) throw error;
    const { workspace } = error.data;
    await write(
      io.stdout,
      args.json ? `${JSON.stringify({ stopped: false, workspace })}\n` : nothingToStop(workspace),
    );
  }
  return exitCodes.ok;
}

export const stopShortcut: Shortcut = {
  name: "stop",
  usage: "stop",
  summary: "workspace.stop: stop the daemon",
  help,
  run,
};
