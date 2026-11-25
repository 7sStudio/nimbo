// The lock files git leaves when it is killed before it can remove them. After a cancelled operation, a lock that was
// not there when it started is its own (the daemon runs one git write at a time), so it is removed; any other lock
// belongs to a git the daemon did not start and stays.
import { access, rm } from "node:fs/promises";
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

/** Removes the locks that appeared since `before`. */
export async function clearLeftLocks(gitDir: string, before: ReadonlySet<string>): Promise<void> {
  for (const name of await locksIn(gitDir))
    if (!before.has(name)) await rm(join(gitDir, name), { force: true });
}
