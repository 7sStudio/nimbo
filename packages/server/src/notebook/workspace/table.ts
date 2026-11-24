// The table of the workspace's open notebooks (notebooks.ts): its entries and the closes under way, the gate that
// lets opens, creates, deletes and renames check the table one at a time, and the refusals they share.
import { notebookPath } from "../../files/notebooks/notebookFile.js";
import type { Session } from "../session/session.js";
import { openRefOf } from "./identity.js";
import { DaemonStopping, NotebookAlreadyOpen } from "./openErrors.js";
import type { NotebooksOptions } from "./openings.js";

/** An open (or opening) notebook: its file's absolute path and its session. */
export type Entry = { readonly path: string; readonly opening: Promise<Session> };

/** A close under way: the file it closes, and its end. */
type Closing = { readonly path: string; readonly done: Promise<void> };

export type Table = {
  readonly entries: Map<string, Entry>;
  /** The closes under way: a second close of a ref joins its first, an open of it or of its file waits for it. */
  readonly closing: Map<string, Closing>;
  stopping: boolean;
  /** Opens and creates check the table and enter it one at a time; their loads then run side by side. */
  gate: Promise<unknown>;
};

/** Runs `task` once the opens and creates before it have entered the table. */
export function exclusive<T>(table: Table, task: () => Promise<T>): Promise<T> {
  const run = table.gate.then(task, task);
  table.gate = run.catch(() => undefined);
  return run;
}

/** Enters `opening` for `ref`; a failed opening leaves the table again, when it is still the entry of `ref`. */
export function enter(
  table: Table,
  ref: string,
  entry: Entry,
): { readonly opening: Promise<Session> } {
  table.entries.set(ref, entry);
  entry.opening.catch(() => {
    if (table.entries.get(ref) === entry) table.entries.delete(ref); // the next open tries again
  });
  return { opening: entry.opening };
}

/** Refuses an open or a create of `ref` while the daemon stops. */
export function refuseStopping(table: Table, ref: string): void {
  if (table.stopping) throw new DaemonStopping({ path: ref });
}

/** Refuses an open of `path` when another ref holds its file open, as the file is now. */
export async function refuseTwin(table: Table, ref: string, path: string): Promise<void> {
  const open = new Map([...table.entries].map(([openRef, entry]) => [openRef, entry.path]));
  const twin = await openRefOf(path, ref, open);
  if (twin !== undefined) throw new NotebookAlreadyOpen({ path: ref, open: twin });
}

/** The ref of a close under way of the file `ref` names under another ref, if any (nothing there: none). */
async function closingTwin(options: NotebooksOptions, table: Table, ref: string) {
  if (table.closing.size === 0) return undefined;
  const closing = new Map([...table.closing].map(([closingRef, { path }]) => [closingRef, path]));
  // A ref that names nothing or no notebook fails in the open or create itself, with its own error.
  const path = await notebookPath(options.root, ref).catch(() => undefined);
  return path === undefined ? undefined : openRefOf(path, ref, closing).catch(() => undefined);
}

/** Waits for a close under way of `ref`, or of its file under another ref, whatever its outcome (its caller has that). */
export async function afterClose(
  options: NotebooksOptions,
  table: Table,
  ref: string,
): Promise<void> {
  await table.closing.get(ref)?.done.catch(() => undefined);
  const twin = await closingTwin(options, table, ref);
  if (twin !== undefined) await table.closing.get(twin)?.done.catch(() => undefined);
}
