// Following an open notebook's file when it moves (07-file-format §5): a rename outside nimbo (`mv`, git,
// Finder, an agent's file tools) keeps the file's device and inode, which the session knows from its open and from
// each save (an atomic save makes a new inode, so the identity is taken again after every write). When nothing is at
// the session's path any more, the workspace's notebooks are searched for that identity; exactly one match inside the
// workspace, reached through no link and not open under another ref, is where the notebook went: the table's entry
// and the session take the new ref and path (notebook.moved on the old stream, notebooks.changed after), and the kernel
// runs on. No match (moved out of the workspace, into a hidden folder, deleted, or across devices) changes nothing: the
// next save writes the old path again, as before. The check runs every `everyMs` for each open notebook, before an
// open (so an open of the new path finds the session), and inside a save that found its file gone.
import { lstat } from "node:fs/promises";
import { join } from "node:path";

import type { FileIdentity } from "../../files/atomicWrite.js";
import { plainNotebookFile } from "../../files/notebooks/plainPath.js";
import { scanWorkspace } from "../../files/notebooks/scan.js";
import type { Session } from "../session/session.js";
import type { NotebooksOptions } from "./openings.js";
import type { Table } from "./table.js";

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

/** Whether something is at `path` (a link counts, as itself); a failure other than ENOENT counts as there. */
const present = (path: string): Promise<boolean> =>
  lstat(path).then(
    () => true,
    (error: unknown) => codeOf(error) !== "ENOENT",
  );

/** The one notebook of the workspace whose file is `identity`, reached through no link; undefined unless exactly one. */
async function located(root: string, identity: FileIdentity): Promise<string | undefined> {
  const { notebooks } = await scanWorkspace(root);
  const found: string[] = [];
  for (const ref of notebooks) {
    const stats = await lstat(join(root, ...ref.split("/"))).catch(() => undefined);
    if (stats?.isFile() !== true || stats.dev !== identity.dev || stats.ino !== identity.ino)
      continue;
    const plain = await plainNotebookFile(root, ref, "path").then(
      () => true,
      () => false, // a ref no notebook may have, or reached through a link: not followed
    );
    if (plain) found.push(ref);
  }
  return found.length === 1 ? found[0] : undefined;
}

export type Follower = {
  /** Follows the file of every open notebook that left its path. */
  readonly all: () => Promise<void>;
  /** Follows `session`'s file, if it left its path (a save found nothing there). */
  readonly one: (session: Session) => Promise<void>;
  readonly stop: () => void;
};

/** Follows `session`'s file to where it moved, if it left its path: the table's entry and the session take the new ref. */
async function follow(options: NotebooksOptions, table: Table, session: Session): Promise<void> {
  const { root } = options;
  const from = session.ref;
  const entry = table.entries.get(from);
  const { path, identity } = session.context;
  // a linked notebook writes through to its target (07 §5), which is not followed; nor is a file never identified
  if (entry === undefined || identity === undefined || path !== join(root, ...from.split("/")))
    return;
  if (await present(path)) return;
  const to = await located(root, identity);
  // checked again after the search: a close, a stop or another open may have come meanwhile
  if (to === undefined || table.stopping || table.entries.get(from) !== entry) return;
  if (table.entries.has(to) || table.closing.has(to)) return;
  const moved = join(root, ...to.split("/"));
  table.entries.delete(from);
  table.entries.set(to, { path: moved, opening: entry.opening });
  await session.moveTo(to, moved);
  options.log.info({ from, to }, "an open notebook's file moved; it is followed");
  await options.listChanged();
}

/** Runs `run` every `everyMs` while the last one is done (none when 0); returns the clear function. */
function every(everyMs: number, run: () => Promise<void>): () => void {
  if (everyMs <= 0) return () => undefined;
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void run().finally(() => {
      running = false;
    });
  }, everyMs);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}

/** The follower of `table`'s notebooks; its periodic check runs every `everyMs` (none when 0). */
export function createFollower(options: NotebooksOptions, table: Table, everyMs: number): Follower {
  // one follow at a time per session: the periodic check, an open and a save may all find the file gone at once
  const following = new WeakMap<Session, Promise<void>>();
  const one = (session: Session): Promise<void> => {
    const under = following.get(session);
    if (under !== undefined) return under;
    const run = follow(options, table, session)
      .catch((error: unknown) => {
        options.log.warn(
          { err: error, notebook: session.ref },
          "a moved notebook could not be followed",
        );
      })
      .finally(() => following.delete(session));
    following.set(session, run);
    return run;
  };
  const all = async (): Promise<void> => {
    const openings = [...table.entries.values()].map((entry) => entry.opening);
    const sessions = await Promise.all(openings.map((opening) => opening.catch(() => undefined)));
    await Promise.all(sessions.map((session) => (session ? one(session) : Promise.resolve())));
  };
  const stop = every(everyMs, () => (table.entries.size === 0 ? Promise.resolve() : all()));
  return { all, one, stop };
}
