// What a cancelled git write may leave: lock files in the git dir and `.merge_file_*` temporaries in the work tree.
// SIGTERM lets git remove its own; a lock is removed by the daemon only when it had to SIGKILL its git and no other
// git runs on the machine (a terminal's git may hold it), else it is named for the user to remove. The temporaries
// that appeared during the write are the killed merge's and go.
import { execFile } from "node:child_process";
import { access, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const names = [
  "index.lock",
  "HEAD.lock",
  "ORIG_HEAD.lock",
  "MERGE_HEAD.lock",
  "AUTO_MERGE.lock",
  "config.lock",
  "packed-refs.lock",
];

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

/** The lock files in `gitDir` now. */
export async function locksIn(gitDir: string): Promise<ReadonlySet<string>> {
  const found = await Promise.all(
    names.map(async (name) => [name, await exists(join(gitDir, name))] as const),
  );
  return new Set(found.filter(([, there]) => there).map(([name]) => name));
}

/** git's merge temporaries in `top`. */
export async function mergeTemporaries(top: string): Promise<ReadonlySet<string>> {
  const entries = await readdir(top).catch(() => []);
  return new Set(entries.filter((name) => name.startsWith(".merge_file_")));
}

/** Whether a process named git runs (pgrep); true when that cannot be told. */
const gitRuns = (): Promise<boolean> =>
  new Promise((resolve) => {
    execFile("pgrep", ["-x", "git"], (error) => {
      resolve(error === null || Reflect.get(error, "code") === "ENOENT");
    });
  });

export type Before = {
  readonly locks: ReadonlySet<string>;
  readonly temporaries: ReadonlySet<string>;
};

/** Cleans up after a cancelled write; answers the lock files left for the user, by name. */
export async function afterCancel(
  gitDir: string,
  top: string,
  before: Before,
  killed: boolean,
): Promise<readonly string[]> {
  for (const name of await mergeTemporaries(top))
    if (!before.temporaries.has(name)) await rm(join(top, name), { force: true });
  const left = [...(await locksIn(gitDir))].filter((name) => !before.locks.has(name));
  if (left.length === 0 || !killed || (await gitRuns())) return left;
  for (const name of left) await rm(join(gitDir, name), { force: true });
  return [];
}
