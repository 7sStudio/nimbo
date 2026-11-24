// cache.clear (03-api §4.14): the npm cache emptied while the daemon runs. The folder is renamed aside in
// one step and a fresh empty one made in its place, so a request under way either finds its entry whole in the old
// folder or nothing in the new one: an entry a build was writing when the folder moved lacks its meta.json in the new
// folder and is built again (cache.ts writes meta.json last). The folder aside is then measured and removed, a link in
// it removed as itself, never followed. Folders a clear that crashed left aside are removed by the next clear.
import { randomBytes } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

const asidePrefix = (cacheDir: string): string => `${basename(cacheDir)}.cleared-`;

/** The bytes of the files under `dir`, read with lstat (a link counts as itself). */
async function bytesUnder(dir: string): Promise<number> {
  const entries: Dirent[] = await readdir(dir, { withFileTypes: true }).catch(() => []);
  let bytes = 0;
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) bytes += await bytesUnder(path);
    else bytes += (await lstat(path).catch(() => undefined))?.size ?? 0;
  }
  return bytes;
}

/** The names of the folders in `dir` (no link), none when it cannot be read. */
const foldersIn = async (dir: string): Promise<readonly string[]> =>
  (await readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

/** The bundle entries under the npm cache folder `dir`: `<name>@<version>`, `@scope/<name>@<version>` and `_/<key>`. */
async function entriesIn(dir: string): Promise<number> {
  let count = 0;
  for (const name of await foldersIn(dir)) {
    if (name === "_" || name.startsWith("@")) count += (await foldersIn(join(dir, name))).length;
    else count += 1;
  }
  return count;
}

/** Empties the npm cache `cacheDir`; answers how many bundle entries and bytes went. */
export async function clearNpmCache(
  cacheDir: string,
): Promise<{ readonly entries: number; readonly bytes: number }> {
  const parent = dirname(cacheDir);
  const aside = join(
    parent,
    `${asidePrefix(cacheDir)}${String(process.pid)}-${randomBytes(4).toString("hex")}`,
  );
  let moved = true;
  try {
    await rename(cacheDir, aside);
  } catch (error) {
    if (codeOf(error) !== "ENOENT") throw error;
    moved = false; // no cache yet
  }
  await mkdir(cacheDir, { recursive: true });
  const stale = (await readdir(parent).catch(() => [])).filter(
    (name) => name.startsWith(asidePrefix(cacheDir)) && join(parent, name) !== aside,
  );
  // a link planted in the cache's place is removed as itself, never read through (07 §7)
  const real = moved && (await lstat(aside)).isDirectory();
  const measured = real
    ? { entries: await entriesIn(aside), bytes: await bytesUnder(aside) }
    : { entries: 0, bytes: 0 };
  await Promise.all(
    [...(moved ? [aside] : []), ...stale.map((name) => join(parent, name))].map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
  return measured;
}
