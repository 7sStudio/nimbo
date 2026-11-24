// The npm cache's own folders and files, never through a symbolic link. A crafted workspace can plant links in `.jsnb/cache/npm/`: a bundle, a meta.json or a record of an entry, a whole
// `<name>@<version>` or `_/<key>` folder, `_index.json`; a page would then load their targets as bundles. So an
// entry's folders are checked with lstat from the cache's own folder down before any file in them is opened, every
// cache file is opened with O_NOFOLLOW (a link put in a file's place after that check is refused at the open), and a
// link, or anything else where a folder of an entry belongs, is removed itself, never followed: the entry is then
// absent and built again from the real package, as a missing one is. Writes go to a temp name created exclusively and
// renamed into place (atomicWrite.ts), so no write follows a link either. An entry's folder comes from a package name
// (npm's rule), a version (one encoded segment) or a key (hex); its segments are checked as plain names anyway.
import { lstat, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";

import { readRegularFile } from "../regularFile.js";
import { isPlainSegment } from "./spec.js";

/** The cache file `path` as text: a regular file of at most `maxBytes`, opened with O_NOFOLLOW; else undefined. */
export async function readCacheFile(path: string, maxBytes: number): Promise<string | undefined> {
  const read = await readRegularFile(path, maxBytes, { follow: false });
  return read.kind === "read" ? read.text : undefined; // missing, a link or anything else: no cache, built again
}

/** Whether `path` is a real folder now: not a link, not a file; false when nothing is there or it cannot be checked. */
export async function isRealFolder(path: string): Promise<boolean> {
  return lstat(path).then(
    (stats) => stats.isDirectory(),
    () => false,
  );
}

/** Whether `path` is a real folder (true), is not there (false), or is something else (a link, a file), now removed. */
async function realFolderAt(path: string): Promise<boolean> {
  const stats = await lstat(path).catch((error: unknown) => {
    if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") return undefined;
    throw error;
  });
  if (stats === undefined) return false;
  if (stats.isDirectory()) return true;
  await unlink(path); // the link itself, or a stray file: never what a link points to
  return false;
}

/** An entry's folder in the cache: its path, and whether it is there as real folders down from the cache's own. */
export type CacheFolder = { readonly path: string; readonly present: boolean };

/**
 * The folder of the entry `dir` (`<name>@<version>`, `@scope/<name>@<version>` or `_/<key>`, `_` the resolved forms'
 * own folder) in `cacheDir`, the cache's own folder and each folder below it checked with lstat from the top, a link or
 * a file in a folder's place removed: absent from there on. Undefined when the cache's own folder is not a real one
 * (it is never removed: the daemon checked it at start), when the segments are not plain names, or when the check
 * itself fails: nothing is read from or written to the entry then.
 */
export async function cacheFolder(cacheDir: string, dir: string): Promise<CacheFolder | undefined> {
  const segments = dir.split("/");
  if (!segments.every(isPlainSegment) || !(await isRealFolder(cacheDir))) return undefined;
  const path = join(cacheDir, ...segments);
  try {
    for (let depth = 1; depth <= segments.length; depth += 1) {
      if (!(await realFolderAt(join(cacheDir, ...segments.slice(0, depth))))) {
        return { path, present: false };
      }
    }
    return { path, present: true };
  } catch {
    return undefined; // a folder that cannot be checked, or a link that cannot be removed: left alone
  }
}

/** The folder of the entry `dir` made where it is absent, after the same check; undefined when it cannot be. */
export async function madeCacheFolder(cacheDir: string, dir: string): Promise<string | undefined> {
  const folder = await cacheFolder(cacheDir, dir);
  if (folder === undefined) return undefined;
  if (!folder.present) await mkdir(folder.path, { recursive: true });
  return folder.path;
}
