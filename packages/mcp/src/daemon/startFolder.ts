// The start folder of a daemon start, the CLI's format written once more here (no cli ↔ mcp edge):
// `<workspace>/.jsnb/start-<the starter's pid>-<random>/` (0700, its files 0600), or `<tmp>/nimbo-start-<pid>-<random>/`
// when `.jsnb` cannot be made there. It holds the daemon's stderr until the daemon listens (then moved into
// `.jsnb/logs/stderr.log`, never across devices in the normal case) and `start.json`. A starter (a CLI or an MCP
// server; one format, so each sweeps the other's) killed before the move leaves the folder, and its daemon lives on:
// each start first sweeps such folders (sweep.ts).
import { writeFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { moveInto, recordFile } from "./startRecord.js";
import { sweepStartFolders } from "./sweep.js";

/** `<workspace>/.jsnb`, made when missing, or undefined when it is not a real folder (a file there, a link). */
async function jsnbFolder(workspace: string): Promise<string | undefined> {
  const jsnb = join(workspace, ".jsnb");
  try {
    await mkdir(jsnb, { recursive: true });
    const stats = await lstat(jsnb);
    return stats.isDirectory() && !stats.isSymbolicLink() ? jsnb : undefined;
  } catch {
    // ENOTDIR or EEXIST for a file, EACCES above it: the start folder goes to the temp folder, the daemon names it.
    return undefined;
  }
}

/** The codes of a folder the starter may not write into: read-only (mode 555, another user's) or on a read-only disk. */
const unwritable = new Set(["EACCES", "EPERM", "EROFS"]);

/**
 * The start folder: in `.jsnb` when it is a real folder the starter can write into, else in the temp folder, where the
 * start goes on and the daemon names what it cannot do with the workspace.
 */
async function startFolder(jsnb: string | undefined): Promise<string> {
  const pid = String(process.pid);
  if (jsnb !== undefined) {
    try {
      return await mkdtemp(join(jsnb, `start-${pid}-`));
    } catch (error) {
      if (!(error instanceof Error) || !unwritable.has(String(Reflect.get(error, "code"))))
        throw error;
    }
  }
  return mkdtemp(join(tmpdir(), `nimbo-start-${pid}-`));
}

/** The stderr file of a daemon about to start for `workspace`, in a start folder until the daemon listens. */
export async function stderrFile(workspace: string) {
  const jsnb = await jsnbFolder(workspace);
  await sweepStartFolders(jsnb, workspace);
  const dir = await startFolder(jsnb);
  const record = (daemon?: number): void => {
    // Written at once, not awaited: the spawn's error must still be heard on the next tick.
    const content = daemon === undefined ? { workspace } : { workspace, pid: daemon };
    writeFileSync(join(dir, recordFile), JSON.stringify(content), { mode: 0o600 });
  };
  record();
  const path = join(dir, "stderr.log");
  const handle = await open(path, "w", 0o600); // the daemon's raw stderr, beside its 0600 logs
  const removeDir = async (): Promise<void> => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // Windows keeps a file the daemon has open: it stays, and a later start sweeps it.
    }
  };
  return {
    fd: handle.fd,
    close: () => handle.close(),
    read: () => readFile(path, "utf8"),
    /** Records the spawned daemon's pid (none when the spawn failed). */
    record: (daemon: number | undefined): void => {
      if (daemon !== undefined) record(daemon);
    },
    /** A daemon that failed: its words are read, the folder goes. */
    remove: removeDir,
    /** A daemon that listens keeps writing its stderr into `.jsnb/logs/stderr.log`; the folder goes. */
    keep: async (): Promise<void> => {
      if (await moveInto(path, workspace, { copy: false })) await removeDir();
    },
  };
}
