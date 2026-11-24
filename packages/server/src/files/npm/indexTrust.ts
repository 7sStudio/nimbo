// Whether a resolved key's entry still holds, checked when it is read. Its key is the hash of its folder and version. Its lookup folder `from` (the folder its
// import was resolved from) is read only when it is absolute, normalised (no empty, `.` or `..` segment, no backslash
// or NUL) and its own real path, naming a folder that exists, as every lookup folder the daemon records is; anything
// else (a `..`, a link with a plain name) is no lookup folder. Then `from` must be (1) the workspace's real path or a
// folder below it the path rule allows (no hidden or refused segment: where a workspace module's imports start), or
// (2) inside a package Node resolves from the workspace (the page's own import of its name finds it), or (3) inside
// the real folder of another entry that holds (a cycle holds nothing); each "inside" is a comparison of real paths at
// a path boundary (an ancestor's whole path, or a prefix followed by a separator), so `b-evil` is not inside `b`. And
// in every case its folder is what Node resolves for its name from `from` now, at the recorded version. So a planted
// entry serves only what a workspace module could import itself; pnpm's `.pnpm/b@1/node_modules/b`, reached from
// inside `a` beside it, holds through `a` (2), and `c`, reached from inside `b`, through `b`'s entry (3).
import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

import { readRegularFile } from "../regularFile.js";
import { parsedJson } from "./inputs.js";
import type { FoundPackage } from "./resolve.js";
import { findPackage } from "./resolve.js";
import { isNormalAbsolute, isWorkspacePath } from "./spec.js";

export const Entry = z.object({
  folder: z.string(),
  from: z.string(),
  name: z.string(),
  version: z.string(),
});
export type IndexEntry = z.infer<typeof Entry>;

/** The key of a package folder: the hash covers its real path and version, so two installs never share one. */
export const keyOf = (found: { readonly folder: string; readonly version: string }): string =>
  createHash("sha256").update(`${found.folder}\n${found.version}`).digest("hex").slice(0, 16);

/** A package.json's name, read as a regular file only; undefined when there is none. */
const PackageName = z.looseObject({ name: z.string().optional() });

async function nameAt(folder: string): Promise<string | undefined> {
  const read = await readRegularFile(join(folder, "package.json"), 1024 * 1024);
  return read.kind === "read" ? PackageName.safeParse(parsedJson(read.text)).data?.name : undefined;
}

/** What a check of the index reads: the workspace's real path and every entry, by key. */
type Index = { readonly root: string; readonly entries: ReadonlyMap<string, IndexEntry> };

/**
 * Whether `folder` (an ancestor of a real lookup folder, itself a real path) is the real folder of another entry that
 * holds (`seen` the keys on the way, against a cycle): a holding entry's folder is the real path Node resolved.
 */
async function anotherHolds(index: Index, folder: string, seen: Set<string>): Promise<boolean> {
  for (const [key, entry] of index.entries) {
    if (entry.folder !== folder || seen.has(key)) continue;
    if ((await foundIfHolds(index, key, seen)) !== undefined) return true;
  }
  return false;
}

/**
 * Whether the real lookup folder `from` is a folder of the workspace the path rule allows (1), or lies inside a package
 * the page's import of its name finds (2) or inside the real folder of a holding entry (3): each of its ancestors, whole
 * paths, compared with those real folders.
 */
async function trusted(index: Index, from: string, seen: Set<string>): Promise<boolean> {
  if (isWorkspacePath(index.root, from)) return true; // the root, or below it after a separator, no hidden segment
  for (let folder = from; ; folder = dirname(folder)) {
    const name = await nameAt(folder);
    if (name !== undefined && (await findPackage(name, index.root))?.folder === folder) return true;
    if (await anotherHolds(index, folder, seen)) return true;
    if (dirname(folder) === folder) return false;
  }
}

/**
 * Whether `from` is a lookup folder the daemon could have recorded: absolute, normalised, its own real path, a folder
 * that exists. A `..` in it, or a link with a plain name, would let the checks below read one path while Node's
 * resolution walks another.
 */
async function isRealFolder(from: string): Promise<boolean> {
  if (!isNormalAbsolute(from)) return false;
  try {
    return (await realpath(from)) === from && (await stat(from)).isDirectory();
  } catch {
    return false; // not there, or a link to nothing
  }
}

/** The package `key` names as Node finds it now, while its entry holds (`seen` the keys checked on the way). */
export async function foundIfHolds(
  index: Index,
  key: string,
  seen = new Set<string>(),
): Promise<FoundPackage | undefined> {
  const entry = index.entries.get(key);
  if (entry === undefined || keyOf(entry) !== key) return undefined;
  seen.add(key);
  if (!(await isRealFolder(entry.from))) return undefined;
  const found = await findPackage(entry.name, entry.from); // its folder a real path: Node's resolution realpaths it
  if (found?.folder !== entry.folder || found.version !== entry.version) return undefined;
  return (await trusted(index, entry.from, seen)) ? found : undefined;
}
