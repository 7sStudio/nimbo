// A notebook file on disk (07-file-format §5, 09-testing §5): its ref resolved inside the workspace (no `..`, no
// absolute path, no folder or file that a symbolic link takes outside it, a link to nothing named with its target),
// its bytes read with their hash, and the atomic write beside it.
import { createHash } from "node:crypto";
import { lstat, mkdir, readlink, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { InvalidParams, JsnbError } from "@jsnb/core";
import { validateNotebookRef } from "@jsnb/kernel-node";

import type { FileIdentity } from "../atomicWrite.js";
import type { raced } from "../atomicWrite.js";
import { isSymbolicLink, writeAtomically } from "../atomicWrite.js";
import { readRegularFile } from "../regularFile.js";

/** A notebook is a program's file: far below this. */
const maxNotebookBytes = 64 * 1024 * 1024;

export type NotebookRead =
  | { readonly kind: "missing" }
  | { readonly kind: "read"; readonly text: string; readonly hash: string };

/** The sha256 of a file's text, compared before every write (07-file-format §5). */
export const hashOf = (text: string): string => createHash("sha256").update(text).digest("hex");

const outside = (ref: string, field: string): InvalidParams =>
  new InvalidParams({
    issues: [{ path: [field], message: `${ref} leads outside the workspace` }],
  });

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

const isInside = (root: string, path: string): boolean => {
  const rest = relative(root, path);
  return !rest.startsWith("..") && !isAbsolute(rest);
};

type Where = { readonly path: string; readonly reason: string };

/** A notebook path that holds something the daemon will not read as a notebook (a FIFO, a folder, too large). */
class NotebookUnreadable extends JsnbError {
  declare readonly data: Where;
  constructor(data: Where) {
    super({
      name: "NotebookUnreadable",
      message: `${data.path} cannot be read as a notebook: ${data.reason}. Put a .jsnb file there or pick another path.`,
      data,
    });
  }
}

type Refused = { readonly path: string; readonly code: string };

/** What a code the file system answers for a path means to a user. */
const refusals: Readonly<Record<string, string>> = {
  ENOTDIR: "a part of it is a file, not a folder",
  ENAMETOOLONG: "a name in it is too long for the file system",
  ELOOP: "a link on it leads back to itself",
  EACCES: "a folder on it cannot be read",
  EPERM: "a folder on it cannot be read",
};

/** The file system refused a notebook's path with something other than "nothing there" (ENOENT). */
class NotebookPathRefused extends JsnbError {
  declare readonly data: Refused;
  constructor(data: Refused, options: { readonly cause?: unknown } = {}) {
    const why = refusals[data.code] ?? "the file system refused it";
    super({
      name: "NotebookPathRefused",
      message: `${data.path} cannot be used as a notebook: ${why} (${data.code}). Pick another path, or fix the folder on it.`,
      data,
      ...options,
    });
  }
}

type Broken = { readonly path: string; readonly target: string };

/**
 * A notebook ref that is a link to nothing: its target moved or never checked out. Open would say
 * "not found, create it" and create "already exists, open it", so every command names the link and its target.
 */
class NotebookLinkBroken extends JsnbError {
  declare readonly data: Broken;
  constructor(data: Broken) {
    super({
      name: "NotebookLinkBroken",
      message: `${data.path} is a link to ${data.target}, which is not there. Restore ${data.target}, or remove the link ${data.path}.`,
      data,
    });
  }
}

/**
 * The file a notebook is saved to became a symbolic link after the notebook was opened: a save does not follow it, nor replace it. A notebook opened through a link is
 * saved to the file it named then, which this does not refuse.
 */
class NotebookBecameLink extends JsnbError {
  declare readonly data: { readonly path: string };
  constructor(data: { readonly path: string }) {
    super({
      name: "NotebookBecameLink",
      message: `${data.path} became a symbolic link after the notebook was opened, and a save does not follow it. Remove the link, or close the notebook and open it again to save to the file the link names.`,
      data,
    });
  }
}

/** A Node system error (it names its syscall), as opposed to an error this module raised. */
const isSystemError = (error: unknown): boolean =>
  error instanceof Error && typeof Reflect.get(error, "syscall") === "string";

/** The nearest existing folder at or above `dir`, resolved through its links. */
async function existingFolder(dir: string): Promise<string> {
  try {
    return await realpath(dir);
  } catch (error) {
    if (codeOf(error) !== "ENOENT" || dirname(dir) === dir) throw error;
    return existingFolder(dirname(dir));
  }
}

/**
 * The absolute path of `ref` in the workspace `root` (already resolved through links); InvalidParams for a ref that
 * names no notebook (kernel-node's rule) or one whose folder or file a symbolic link takes outside the workspace. A
 * notebook that is a link answers its target: reads and atomic writes go to the file the link names,
 * so a save keeps the link a link, and a link re-pointed later is not followed, as renames are not (07 §5).
 */
export async function notebookPath(root: string, ref: string, field = "notebook"): Promise<string> {
  validateNotebookRef(ref, field);
  try {
    return await resolvedPath(root, ref, field);
  } catch (error) {
    // ENOTDIR, ENAMETOOLONG, ELOOP, EACCES… on the path: a named error, never the daemon-bug answer.
    const code = codeOf(error);
    if (isSystemError(error) && typeof code === "string") {
      throw new NotebookPathRefused({ path: ref, code }, { cause: error });
    }
    throw error;
  }
}

/**
 * The link `path` (`ref`) whose target is not there: outside the workspace when its target's nearest folder is,
 * else NotebookLinkBroken naming the target as the link writes it; nothing is ever created through it.
 */
async function brokenLink(root: string, ref: string, path: string, field: string): Promise<never> {
  const target = await readlink(path);
  const named = resolve(dirname(path), target);
  if (!isInside(root, await existingFolder(dirname(named)))) throw outside(ref, field);
  throw new NotebookLinkBroken({ path: ref, target });
}

/** notebookPath's resolution; it throws what the file system answers, ENOENT aside. */
async function resolvedPath(root: string, ref: string, field: string): Promise<string> {
  const path = join(root, ...ref.split("/"));
  if (!isInside(root, await existingFolder(dirname(path)))) throw outside(ref, field);
  const link = await lstat(path).then(
    (stats) => stats.isSymbolicLink(),
    (error: unknown) => {
      if (codeOf(error) !== "ENOENT") throw error;
      return undefined; // nothing there yet: the path as named
    },
  );
  if (link !== true) return path;
  const target = await realpath(path).catch((error: unknown) => {
    if (codeOf(error) !== "ENOENT") throw error;
    return undefined; // a link to nothing
  });
  if (target === undefined) return brokenLink(root, ref, path, field);
  if (!isInside(root, target)) throw outside(ref, field);
  return target;
}

/** Reads a notebook's text and hash; `missing` when there is no such file. */
export async function readNotebook(path: string): Promise<NotebookRead> {
  const read = await readRegularFile(path, maxNotebookBytes);
  if (read.kind === "missing") return read;
  if (read.kind === "refused") throw new NotebookUnreadable({ path, reason: read.reason });
  return { kind: "read", text: read.text, hash: hashOf(read.text) };
}

/** The hash of what is on disk now, undefined when the file is gone. */
export async function hashOnDisk(path: string): Promise<string | undefined> {
  const read = await readNotebook(path);
  return read.kind === "read" ? read.hash : undefined;
}

/** The workspace folder is gone (moved or deleted under the running daemon): no save recreates it. */
class WorkspaceGone extends JsnbError {
  declare readonly data: { readonly root: string };
  constructor(data: { readonly root: string }) {
    super({
      name: "WorkspaceGone",
      message: `The workspace folder ${data.root} is gone (moved or deleted); the daemon stops.`,
      data,
    });
  }
}

const isFolder = (path: string): Promise<boolean> =>
  stat(path).then(
    (stats) => stats.isDirectory(),
    () => false,
  );

/**
 * Writes the notebook atomically to `path` (a linked notebook's target, resolved when it opened), creating its folder
 * inside the workspace when needed but never the workspace `root` itself (a save after the folder was moved would
 * resurrect it at the old path and the daemon would never notice the move); a symbolic link that has
 * appeared at `path` since is NotebookBecameLink, checked with lstat before the write, and the rename never follows
 * one either (07 §5).
 */
export async function writeNotebook(
  path: string,
  text: string,
  root: string,
  replaces?: (current: string | undefined) => boolean,
): Promise<FileIdentity | typeof raced> {
  if (!(await isFolder(root))) throw new WorkspaceGone({ root });
  await mkdir(dirname(path), { recursive: true });
  if (await isSymbolicLink(path)) throw new NotebookBecameLink({ path });
  return writeAtomically(path, text, replaces === undefined ? {} : { replaces });
}
