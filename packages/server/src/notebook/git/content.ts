// One side of a diff: a revision's blob, the index's, or the working tree's file; for an open
// notebook the working side is its session's state through the serializer, so an edit shows before its autosave.
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";

import { git, GitOutputTooLarge } from "./exec.js";

/** More than this a side is too large to diff. */
const maxSideBytes = 1024 * 1024;

export type Side =
  | { readonly kind: "none" }
  | { readonly kind: "tooLarge" }
  | { readonly kind: "bytes"; readonly bytes: Buffer };

const none: Side = { kind: "none" };
const tooLarge: Side = { kind: "tooLarge" };

/** The blob of `spec` (`HEAD:sub/a.txt`, `:0:sub/a.txt`); none when git has no such object. */
export async function blob(top: string, spec: string): Promise<Side> {
  try {
    const run = await git(top, ["cat-file", "blob", spec], {
      read: true,
      allowFailure: true,
      maxBytes: maxSideBytes,
    });
    return run.code === 0 ? { kind: "bytes", bytes: run.stdout } : none;
  } catch (error) {
    if (error instanceof GitOutputTooLarge) return tooLarge;
    throw error;
  }
}

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

/** The working tree's file `path` under `root`; a symbolic link reads as its target, as git stores it. */
export async function worktree(root: string, path: string): Promise<Side> {
  const file = join(root, ...path.split("/"));
  const stats = await lstat(file).catch((error: unknown) => {
    if (codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR") return undefined;
    throw error;
  });
  if (stats === undefined || stats.isDirectory()) return none;
  if (stats.isSymbolicLink()) return { kind: "bytes", bytes: Buffer.from(await readlink(file)) };
  if (!stats.isFile()) return none;
  if (stats.size > maxSideBytes) return tooLarge;
  return { kind: "bytes", bytes: await readFile(file) };
}

/** A NUL byte in the first 8 KB: git's own test for a binary file. */
export const isBinary = (side: Side): boolean =>
  side.kind === "bytes" && side.bytes.subarray(0, 8000).includes(0);

export const textOfSide = (side: Side): string | null =>
  side.kind === "bytes" ? side.bytes.toString("utf8") : null;
