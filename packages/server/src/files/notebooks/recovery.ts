// The recovery copy of a notebook's unsaved text (07-file-format §7): `.jsnb/recovery/<sha-256 of the ref>.json`, the
// latest only, written atomically while a conflict is open or a save fails with text the file does not hold, and at a
// close or stop that could not write it; removed once the file holds the session's state. Never through a symbolic
// link: `.jsnb` and `recovery/` are checked with lstat before each read and write, a copy is opened with O_NOFOLLOW and
// read only when the file opened is the one at the copy's path, and a write is checked to have landed there.
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import { JsnbError } from "@jsnb/core";
import { z } from "zod";

import { writeAtomically } from "../atomicWrite.js";

export const Recovery = z.object({
  version: z.literal(1),
  /** The notebook's ref when it was written, checked against the ref it is read for. */
  notebook: z.string(),
  at: z.string(),
  /** The file's text the session last read or wrote (the merge base), null when none. */
  base: z.string().nullable(),
  /** The session's text: what a save would have written. */
  mine: z.string(),
});
export type Recovery = z.infer<typeof Recovery>;

/** What is at a notebook's copy: nothing, a copy, or a file no open may take (`empty`: it holds no text at all). */
export type RecoveryRead =
  | { readonly kind: "none" }
  | { readonly kind: "copy"; readonly copy: Recovery }
  | { readonly kind: "unusable"; readonly reason: string; readonly empty: boolean };

/** `.jsnb` or its `recovery/` is not a real folder now (a symbolic link put there after the daemon started). */
class RecoveryFolderRefused extends JsnbError {
  declare readonly data: { readonly path: string; readonly reason: string };
  constructor(data: { readonly path: string; readonly reason: string }) {
    super({
      name: "RecoveryFolderRefused",
      message: `The recovery folder ${data.path} is not used: ${data.reason}.`,
      data,
    });
  }
}

/** A copy holds two notebook texts at most. */
const maxCopyBytes = 160 * 1024 * 1024;

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

const nameOf = (ref: string): string => createHash("sha256").update(ref).digest("hex");

const recoveryPath = (dir: string, ref: string): string => join(dir, `${nameOf(ref)}.json`);

/** `path` is a real folder, not a link; false when nothing is there. */
async function realFolder(path: string): Promise<boolean> {
  const stats = await lstat(path).catch((error: unknown) => {
    if (codeOf(error) === "ENOENT") return undefined;
    throw error;
  });
  if (stats === undefined) return false;
  if (stats.isSymbolicLink())
    throw new RecoveryFolderRefused({ path, reason: "it is a symbolic link" });
  if (!stats.isDirectory()) throw new RecoveryFolderRefused({ path, reason: "it is not a folder" });
  return true;
}

/** `.jsnb` and `recovery/` as real folders; whether `recovery/` is there (`make`: made when missing). */
async function checkedFolder(dir: string, make = false): Promise<boolean> {
  if (!(await realFolder(dirname(dir)))) return false;
  if (await realFolder(dir)) return true;
  if (!make) return false;
  await mkdir(dir).catch((error: unknown) => {
    if (codeOf(error) !== "EEXIST") throw error;
  });
  return realFolder(dir);
}

type Identity = { readonly dev: number; readonly ino: number };
const sameFile = (a: Identity, b: Identity | undefined): boolean =>
  a.dev === b?.dev && a.ino === b.ino;

/** The identity of the regular file at `path` (not a link), undefined when there is none. */
const fileAt = (path: string): Promise<Identity | undefined> =>
  lstat(path).then(
    (stats) => (stats.isFile() ? stats : undefined),
    () => undefined,
  );

export async function writeRecovery(dir: string, recovery: Recovery): Promise<void> {
  await checkedFolder(dir, true);
  const path = recoveryPath(dir, recovery.notebook);
  const written = await writeAtomically(path, `${JSON.stringify(recovery)}\n`, { mode: 0o600 });
  // a link swapped in while the write was under way: the folders or the file are not the ones checked
  if (written === "raced" || !(await checkedFolder(dir)) || !sameFile(written, await fileAt(path)))
    throw new RecoveryFolderRefused({ path: dir, reason: "it changed during the write" });
}

/** A file in a copy's place that is not one: a FIFO, a folder, over the size a copy can have. */
const notACopy = Symbol("notACopy");

/** The text of the copy at `path` when the file opened is the regular file at that path; undefined when none. */
async function copyText(dir: string, path: string): Promise<string | typeof notACopy | undefined> {
  if (!(await checkedFolder(dir))) return undefined;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  } catch (error) {
    if (codeOf(error) === "ENOENT") return undefined;
    throw error; // a link in the copy's place (ELOOP), or the folder refused
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > maxCopyBytes) return notACopy;
    // the folders may have been a link at the open: the file read must be the one at the copy's path now
    if (!(await checkedFolder(dir)) || !sameFile(stats, await fileAt(path)))
      throw new RecoveryFolderRefused({ path: dir, reason: "it changed during the read" });
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

/** The copy left for `ref`: none, the copy, or an unusable file (empty, cut short, another version, another ref). */
export async function readRecovery(dir: string, ref: string): Promise<RecoveryRead> {
  const text = await copyText(dir, recoveryPath(dir, ref));
  if (text === undefined) return { kind: "none" };
  if (text === notACopy)
    return { kind: "unusable", reason: "it is not a file of a copy's size", empty: false };
  if (text.trim() === "") return { kind: "unusable", reason: "it is empty", empty: true };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: "unusable", reason: "it does not parse", empty: false };
  }
  const parsed = Recovery.safeParse(json);
  if (!parsed.success)
    return { kind: "unusable", reason: "it is not a copy nimbo reads", empty: false };
  if (parsed.data.notebook !== ref)
    return { kind: "unusable", reason: `it is the copy of ${parsed.data.notebook}`, empty: false };
  return { kind: "copy", copy: parsed.data };
}

export async function removeRecovery(dir: string, ref: string): Promise<void> {
  if (!(await checkedFolder(dir))) return;
  await unlink(recoveryPath(dir, ref)).catch((error: unknown) => {
    if (codeOf(error) !== "ENOENT") throw error;
  });
}

/** Renames `ref`'s copy so no open takes it again, its text kept; answers the name it now has. */
export async function setRecoveryAside(
  dir: string,
  ref: string,
  why: "orphaned" | "unusable",
): Promise<string | undefined> {
  if (!(await checkedFolder(dir))) return undefined;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const aside = join(dir, `${nameOf(ref)}.${why}-${stamp}.json`);
  return rename(recoveryPath(dir, ref), aside).then(
    () => aside,
    () => undefined,
  );
}

/** The copy follows its notebook to `to` (a followed move, a rename). */
export async function moveRecovery(dir: string, from: string, to: string): Promise<void> {
  if (from === to) return;
  const read = await readRecovery(dir, from).catch(() => undefined);
  if (read?.kind !== "copy") return;
  await writeRecovery(dir, { ...read.copy, notebook: to });
  await removeRecovery(dir, from);
}
