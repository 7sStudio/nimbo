// notebook.delete and notebook.rename (03-api §4.2): under the table's gate so an open of the same file waits for
// them (and they for a close under way). A delete acts on a notebook no session holds: an open one is NotebookOpen,
// under its own ref or under another ref that names its file (a case variant). A rename of an open notebook moves its
// file and its session follows (07 §5). The rename never replaces a file: it links the new name first, which fails when
// something is there, then removes the old name; on a file system without hard links it checks and renames. The
// notebook's kernel log goes with a delete and follows a rename.
import { NotebookExists, NotebookOpen } from "@jsnb/core";

import { link, lstat, mkdir, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

import { moveKernelLog, removeKernelLog } from "../../files/logs/kernelLog.js";
import { freeNotebookPath, plainNotebookFile } from "../../files/notebooks/plainPath.js";
import { openRefOf } from "./identity.js";
import { NotebookUnwritable } from "./openErrors.js";
import type { NotebooksOptions } from "./openings.js";
import type { Entry, Table } from "./table.js";
import { afterClose, exclusive, refuseStopping } from "./table.js";

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

/** Writes a daemon log line for a kernel log file of `ref` that a delete or a rename had to leave in place. */
const logLeft =
  (options: NotebooksOptions, ref: string) =>
  (file: string, error: unknown): void => {
    options.log.warn(
      { notebook: ref, file, err: error },
      "a kernel log file could not be removed; it stays",
    );
  };

/** NotebookOpen when `ref`, or another open ref naming the file at `path`, is open. */
async function refuseOpen(table: Table, ref: string, path: string): Promise<void> {
  if (table.entries.has(ref)) throw new NotebookOpen({ path: ref });
  const open = new Map([...table.entries].map(([openRef, entry]) => [openRef, entry.path]));
  const twin = await openRefOf(path, ref, open);
  if (twin !== undefined) throw new NotebookOpen({ path: twin });
}

/** Runs a file command on `ref` once no close of it is under way, inside the gate, never while stopping. */
async function underGate<T>(
  options: NotebooksOptions,
  table: Table,
  ref: string,
  task: () => Promise<T>,
): Promise<T> {
  await afterClose(options, table, ref);
  return exclusive(table, async () => {
    refuseStopping(table, ref);
    return task();
  });
}

/** notebook.delete: removes the file of the closed notebook `ref`, and its kernel log; its folder stays. */
export function deleteClosed(options: NotebooksOptions, table: Table, ref: string): Promise<void> {
  return underGate(options, table, ref, async () => {
    const path = await plainNotebookFile(options.root, ref, "path");
    await refuseOpen(table, ref, path);
    await unlink(path);
    await removeKernelLog(options.logsDir, ref, logLeft(options, ref));
  });
}

/** Moves `from` to the free `to` without replacing anything there (`ref`: the target's ref, for the error). */
async function moveFile(from: string, to: string, ref: string): Promise<void> {
  try {
    await link(from, to);
  } catch (error) {
    const code = codeOf(error);
    if (code === "EEXIST") throw new NotebookExists({ path: ref });
    if (code !== "EXDEV" && code !== "EPERM" && code !== "ENOTSUP") throw error;
    // No hard link here (another device inside the workspace, a file system without them): check, then rename.
    const there = await lstat(to).then(
      () => true,
      () => false,
    );
    if (there) throw new NotebookExists({ path: ref });
    await rename(from, to);
    return;
  }
  await unlink(from).catch(async (error: unknown) => {
    await unlink(to).catch(() => undefined); // the old name stays: take the new one back
    throw error;
  });
}

/** The file move of a rename, `from` to the free `target`, its folders created inside the workspace. */
async function moveTo(
  from: string,
  target: { readonly path: string; readonly sameFile: boolean },
  to: string,
): Promise<void> {
  if (target.sameFile) {
    await rename(from, target.path); // only the case of the name changes
    return;
  }
  await mkdir(dirname(target.path), { recursive: true }).catch((error: unknown) => {
    const code = codeOf(error);
    throw new NotebookUnwritable(
      { path: to, code: typeof code === "string" ? code : "EIO" },
      { cause: error },
    );
  });
  await moveFile(from, target.path, to);
}

/**
 * notebook.rename of an open notebook (07 §5): in the queue of its file's writes, so no save lands between, the file
 * moves (its inode kept) and the session takes the new ref and path, its kernel running on; notebook.moved tells its
 * followers.
 */
async function renameOpen(
  table: Table,
  entry: Entry,
  move: { readonly ref: string; readonly from: string; readonly to: string },
  target: { readonly path: string; readonly sameFile: boolean },
): Promise<void> {
  const session = await entry.opening;
  await session.context.autosave.exclusive(async () => {
    await moveTo(move.from, target, move.to);
    table.entries.delete(move.ref);
    table.entries.set(move.to, { path: target.path, opening: entry.opening });
    await session.moveTo(move.to, target.path);
  });
}

/**
 * notebook.rename: moves the file of the notebook `ref` to `to`, creating `to`'s folders in the workspace. A closed
 * notebook's kernel log follows it; an open one keeps its session, which follows the file (07 §5). An open notebook
 * that holds the file under another ref (a case variant) is NotebookOpen, and so is an open `to`.
 */
export function renameNotebook(
  options: NotebooksOptions,
  table: Table,
  ref: string,
  to: string,
): Promise<void> {
  return underGate(options, table, ref, async () => {
    const from = await plainNotebookFile(options.root, ref, "path");
    const target = await freeNotebookPath(options.root, to, { ref, stats: await lstat(from) });
    if (table.entries.has(to) && to !== ref) throw new NotebookOpen({ path: to });
    const entry = table.entries.get(ref);
    if (entry !== undefined) {
      await renameOpen(table, entry, { ref, from, to }, target);
      return;
    }
    await refuseOpen(table, ref, from);
    await moveTo(from, target, to);
    // the kernel log follows the notebook, once the file has moved
    await moveKernelLog(
      options.logsDir,
      { ref, to, sameFile: target.sameFile },
      logLeft(options, ref),
    );
  });
}
