// `nimbo stop`: workspace.stop. With no daemon running there is nothing to stop, which is what the user
// asked for, so it says so and exits 0 instead of 3; it starts no daemon and asks no question (its name is the intent).
// A daemon that lives but does not answer is DaemonUnresponsive (exit 3), unless --force ends it by its pid.
import { endSilent } from "@jsnb/client/node";
import { productVersion, workspaceStop } from "@jsnb/core";

import { silentDaemon } from "../daemon/frozen.js";
import { readServerFile } from "../daemon/serverFile.js";
import {
  DaemonNotRunning,
  DaemonStillRunning,
  DaemonUnresponsive,
  nothingToStop,
} from "../errors/daemon.js";
import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import { findInstallation } from "../install/installation.js";
import { lockHolder, withLock } from "../install/lock.js";
import { sweepVersions } from "../install/local.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import type { Shortcut, ShortcutArgs } from "./shortcut.js";
import { readShortcut, withSession } from "./shortcut.js";

const help = `nimbo stop: stop the workspace's daemon (workspace.stop)

Closes every notebook and stops the daemon. With no daemon running it says so and exits 0. A daemon that runs but
does not answer (stopped or hung) is reported with exit 3; --force then ends its process (SIGTERM, then SIGKILL),
once its pid is checked to be this workspace's daemon.

Flags:
  --force  end a daemon that does not answer by its pid
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

/** Waits for the daemon's process to end (15 s at most): "Stopped" is said only once it has. */
async function exited(pid: number): Promise<void> {
  for (let waited = 0; waited < 15_000 && alive(pid); waited += 100)
    await new Promise((resolve) => setTimeout(resolve, 100));
  if (alive(pid)) throw new DaemonStillRunning({ pid });
}

/**
 * After a daemon of an older installed version stopped: once its process is gone (10 s at most),
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

/** No daemon answered: one that lives but is silent is DaemonUnresponsive, or ended with --force; else nothing to stop. */
async function noAnswer(workspace: string, args: ShortcutArgs, io: Io): Promise<void> {
  const silent = await silentDaemon(workspace);
  if (silent !== undefined) {
    if (args.values.force !== true) throw new DaemonUnresponsive({ workspace, pid: silent.pid });
    if (!(await endSilent(silent.pid))) throw new DaemonStillRunning({ pid: silent.pid });
    await write(
      io.stdout,
      args.json
        ? `${JSON.stringify({ stopped: true, workspace, forced: true })}\n`
        : `Ended the daemon for ${workspace} (pid ${String(silent.pid)}), which did not answer.\n`,
    );
    return;
  }
  await write(
    io.stdout,
    args.json ? `${JSON.stringify({ stopped: false, workspace })}\n` : nothingToStop(workspace),
  );
}

async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  const args = readShortcut("stop", argv, { force: { type: "boolean" } }, { min: 0, max: 0 });
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  try {
    const workspace = await withSession(io, { start: false, command: "stop" }, async (session) => {
      const daemon = await readServerFile(session.workspace);
      await session.call(workspaceStop, {});
      if (daemon !== undefined) await exited(daemon.pid);
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
    await noAnswer(error.data.workspace, args, io);
  }
  return exitCodes.ok;
}

export const stopShortcut: Shortcut = {
  name: "stop",
  usage: "stop [--force]",
  summary: "workspace.stop: stop the daemon",
  help,
  run,
};
