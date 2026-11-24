// The sweep of start folders whose CLI is gone: this workspace's, and the current user's own in
// the temp folder, best effort and one at a time. A live daemon's stderr moves into its workspace's logs once that
// workspace's server.json names it and stays otherwise; a dead daemon's words are kept there as `stderr.log`, which the
// start then keeps as `stderr.previous.log`; only then does the folder go.
import { lstat, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isAlive, readServerFile } from "./serverFile.js";
import { inTemp, inWorkspace, moveInto, readRecord } from "./startRecord.js";

/** The pid of the live daemon `workspace`'s server.json names, or undefined (none, dead, unreadable). */
async function liveDaemonPid(workspace: string): Promise<number | undefined> {
  try {
    const file = await readServerFile(workspace);
    return file !== undefined && isAlive(file.pid) ? file.pid : undefined;
  } catch {
    // An unreadable server.json (ServerFileUnreadable): no daemon the sweep can tie to.
    return undefined;
  }
}

/** Whether a dead daemon left words in its stderr: a crash's stack, Node's warnings. */
async function holdsWords(path: string): Promise<boolean> {
  try {
    return (await stat(path)).size > 0;
  } catch {
    // No stderr file: no words to keep.
    return false;
  }
}

/** A folder whose daemon still runs: its stderr moves home once its workspace's server.json names it, else stays. */
async function sweepLive(dir: string, home: string | undefined, pid: number): Promise<void> {
  if (home === undefined || (await liveDaemonPid(home)) !== pid) return;
  if (await moveInto(join(dir, "stderr.log"), home, { copy: false }))
    await rm(dir, { recursive: true, force: true });
}

/** A folder whose daemon is gone (or never came): its words are kept in its workspace's logs, then it goes. */
async function sweepDead(dir: string, home: string | undefined): Promise<void> {
  const stderr = join(dir, "stderr.log");
  const words = home !== undefined && (await holdsWords(stderr));
  if (words && !(await moveInto(stderr, home, { copy: true }))) return; // its words stay with the folder
  await rm(dir, { recursive: true, force: true });
}

/**
 * A dead CLI's folder: its daemon still running, sweepLive; a daemon of unknown pid in a workspace that has a live
 * one may be this folder's, so it stays; else sweepDead.
 */
async function sweepOne(dir: string, workspace: string | undefined): Promise<void> {
  const record = await readRecord(dir);
  const home = workspace ?? record?.workspace;
  if (record?.pid !== undefined && isAlive(record.pid)) {
    await sweepLive(dir, home, record.pid);
    return;
  }
  const unknown = record !== undefined && record.pid === undefined;
  if (unknown && home !== undefined && (await liveDaemonPid(home)) !== undefined) return;
  await sweepDead(dir, home);
}

/** The names in `dir` of start folders whose CLI is gone. */
async function abandonedIn(dir: string, pattern: RegExp): Promise<readonly string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    // The folder cannot be listed (or is not there): nothing to sweep, and the start goes on.
    return [];
  }
  return names.filter((name) => {
    const pid = Number(pattern.exec(name)?.[1] ?? Number.NaN);
    return Number.isSafeInteger(pid) && pid > 0 && !isAlive(pid);
  });
}

/** Whether a start folder is the current user's own real folder, not a link a shared /tmp or a workspace holds. */
async function ownFolder(path: string): Promise<boolean> {
  const stats = await lstat(path);
  const uid = process.getuid?.();
  return stats.isDirectory() && !stats.isSymbolicLink() && (uid === undefined || stats.uid === uid);
}

/**
 * Sweeps the start folders of CLIs that are gone: this workspace's, and the current user's in the temp folder. One at
 * a time, each on its own: one that cannot be read or changed is not ours to touch, and never fails this start.
 */
export async function sweepStartFolders(
  jsnb: string | undefined,
  workspace: string,
): Promise<void> {
  const found = [
    ...(jsnb === undefined
      ? []
      : (await abandonedIn(jsnb, inWorkspace)).map((name) => ({
          dir: join(jsnb, name),
          workspace,
        }))),
    ...(await abandonedIn(tmpdir(), inTemp)).map((name) => ({
      dir: join(tmpdir(), name),
      workspace: undefined,
    })),
  ];
  for (const folder of found) {
    try {
      // A real folder of the current user's only: a link planted in .jsnb or a shared /tmp is no start folder.
      if (!(await ownFolder(folder.dir))) continue;
      await sweepOne(folder.dir, folder.workspace);
    } catch {
      // EACCES, EPERM, EBUSY: left where it is; the next start of its owner sweeps it.
    }
  }
}
