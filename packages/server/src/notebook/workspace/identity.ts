// One file, one ref (03-api §4.2): the file a ref names is compared with the files the open refs name
// as they are now, by device and inode, so a case variant or a path through a linked folder is caught after any
// number of saves (each save renames a new file into place, a new inode, which is why an identity taken at open goes
// stale). The candidate is read again after the comparison and the comparison redone when a save moved it meanwhile.
import { stat } from "node:fs/promises";

import { NotebookNotFound } from "@jsnb/core";

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

/** The identity of the file at `path` now (device and inode), undefined when nothing is there. */
async function identityNow(path: string): Promise<string | undefined> {
  try {
    const stats = await stat(path);
    return `${String(stats.dev)}:${String(stats.ino)}`;
  } catch (error) {
    if (codeOf(error) === "ENOENT") return undefined;
    throw error;
  }
}

/** How many times a comparison that a save moved is redone; a save takes far longer than one stat. */
const attempts = 3;

/**
 * The open ref (of `open`, ref → absolute path) whose file `path` names, undefined when none; NOTEBOOK_NOT_FOUND
 * (naming `ref`) when nothing is at `path`.
 */
export async function openRefOf(
  path: string,
  ref: string,
  open: ReadonlyMap<string, string>,
): Promise<string | undefined> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const before = await identityNow(path);
    if (before === undefined) throw new NotebookNotFound({ path: ref });
    for (const [openRef, openPath] of open) {
      if ((await identityNow(openPath)) === before) return openRef;
    }
    if ((await identityNow(path)) === before) return undefined;
  }
  return undefined;
}
