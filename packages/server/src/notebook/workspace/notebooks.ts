// The open notebooks of the workspace: notebook.create writes an empty file only when
// none exists and opens it (the file removed again when its session cannot start); notebook.open loads the file and
// starts its kernel once (a second open is the same session); one file is open under one ref only (identity.ts: a case
// variant or a path through a linked folder is NotebookAlreadyOpen, before and after saves); once stopping, nothing
// opens or is created. Two closes of one notebook make one, and an open of a notebook that closes waits for its close,
// also under another ref naming its file (a closing session keeps its identity until its close ends).
// Every other command addresses an open notebook and fails NOTEBOOK_NOT_FOUND otherwise ("is not open" when the file
// exists), but notebook.delete, which acts on closed notebooks only, and notebook.rename (fileMoves.ts); an
// open notebook whose file moves is followed to its new ref (moves.ts). Each
// command that changes the list (a create, a first open, a close, a delete, a rename) announces it once done.
import type { NotebookSummary } from "@jsnb/core";
import { InvalidParams, NotebookExists } from "@jsnb/core";

import { rm } from "node:fs/promises";

import { notebookPath } from "../../files/notebooks/notebookFile.js";
import type { Session } from "../session/session.js";
import { deleteClosed, renameNotebook } from "./fileMoves.js";
import type { Follower } from "./moves.js";
import { createFollower } from "./moves.js";
import { DaemonStopping } from "./openErrors.js";
import { summaryOf } from "./summary.js";
import type { NotebooksOptions } from "./openings.js";
import { load, notOpen, startCreated, writeEmpty } from "./openings.js";
import type { Table } from "./table.js";
import { afterClose, enter, exclusive, refuseStopping, refuseTwin } from "./table.js";

export type Notebooks = {
  readonly create: (ref: string) => Promise<Session>;
  readonly open: (ref: string) => Promise<Session>;
  /** The open session of `ref`; NOTEBOOK_NOT_FOUND (with `closed` when the file exists) otherwise. */
  readonly require: (ref: string) => Promise<Session>;
  readonly close: (ref: string) => Promise<void>;
  /** notebook.delete: the file of a notebook that is not open (fileMoves.ts). */
  readonly remove: (ref: string) => Promise<void>;
  /** notebook.rename: the notebook's file to a free path, an open one's session following it (fileMoves.ts). */
  readonly rename: (ref: string, to: string) => Promise<void>;
  /** notebook.summary: what the notebook holds, from its session when open, else its file (summary.ts). */
  readonly summary: (ref: string) => Promise<NotebookSummary>;
  readonly closeAll: () => Promise<void>;
  readonly openRefs: () => readonly string[];
  /** notebooks.changed with the list as it is now, after a file was written outside these commands (examples.copy). */
  readonly listChanged: () => Promise<void>;
  /** The open notebooks' sessions (a notebook whose open failed is left out). */
  readonly sessions: () => Promise<readonly Session[]>;
  /** The open notebook whose attached page `realmId` names (realm.detach and realm.report carry no notebook). */
  readonly byRealm: (realmId: string) => Promise<Session | undefined>;
  /** The full value of output `index` of `execution`, whichever open notebook ran it. */
  readonly fullValue: (execution: string, index: number) => Promise<{ readonly json: unknown }>;
};

/** The full value of `execution`'s output among `sessions`; INVALID_PARAMS when no open notebook keeps that run. */
async function fullValueAmong(
  sessions: Iterable<Promise<Session>>,
  execution: string,
  index: number,
): Promise<{ readonly json: unknown }> {
  for (const opening of sessions) {
    // A notebook whose open failed holds no run; its caller already has the failure.
    const session = await opening.catch(() => undefined);
    const found = await session?.fullValue(execution, index);
    if (found) return found;
  }
  const message = `${execution} is not the last run of a cell of an open notebook; only each cell's last run is kept`;
  throw new InvalidParams({ issues: [{ path: ["execution"], message }] });
}

async function openNew(options: NotebooksOptions, table: Table, ref: string, follower: Follower) {
  refuseStopping(table, ref);
  await follower.all(); // an open notebook whose file moved to `ref` takes that ref first
  const entered = table.entries.get(ref);
  if (entered) return { opening: entered.opening, fresh: false }; // opened while this waited its turn
  const path = await notebookPath(options.root, ref, "path"); // notebook.open's argument
  await refuseTwin(table, ref, path);
  refuseStopping(table, ref); // the stop may have begun during the awaits
  return { ...enter(table, ref, { path, opening: load(options, ref, path) }), fresh: true };
}

async function createNew(options: NotebooksOptions, table: Table, ref: string) {
  refuseStopping(table, ref);
  if (table.entries.has(ref)) throw new NotebookExists({ path: ref });
  const path = await notebookPath(options.root, ref, "path"); // notebook.create's argument
  const text = await writeEmpty(path, ref);
  if (table.stopping) {
    await rm(path, { force: true }); // the stop began during the awaits: nothing is created
    throw new DaemonStopping({ path: ref });
  }
  return enter(table, ref, { path, opening: startCreated(options, { ref, path }, text) });
}

/** Closes `ref` once: a close under way is joined; NOTEBOOK_NOT_FOUND when it is not open. */
function closeOnce(options: NotebooksOptions, table: Table, ref: string): Promise<void> {
  const under = table.closing.get(ref);
  if (under) return under.done;
  const entry = table.entries.get(ref);
  if (!entry) return notOpen(options, ref);
  table.entries.delete(ref);
  const done = entry.opening
    .then((session) => session.close())
    .finally(() => table.closing.delete(ref));
  table.closing.set(ref, { path: entry.path, done });
  return done;
}

/** close, notebook.delete and notebook.rename, each followed by notebooks.changed (a joined close by none). */
function listChanges(options: NotebooksOptions, table: Table) {
  return {
    close: async (ref: string) => {
      const first = !table.closing.has(ref);
      await closeOnce(options, table, ref);
      if (first) await options.listChanged();
    },
    remove: async (ref: string) => {
      await deleteClosed(options, table, ref);
      await options.listChanged();
    },
    rename: async (ref: string, to: string) => {
      await renameNotebook(options, table, ref, to);
      await options.listChanged();
    },
  };
}

/** The options the sessions open with, their saves calling the follower of `table` (moves.ts). */
function following(given: NotebooksOptions, table: Table) {
  const options: NotebooksOptions = { ...given, follow: (session) => follower.one(session) };
  const follower = createFollower(options, table, given.moveCheckMs ?? 2000);
  return { options, follower };
}

export function createNotebooks(given: NotebooksOptions): Notebooks {
  const table: Table = {
    entries: new Map(),
    closing: new Map(),
    stopping: false,
    gate: Promise.resolve(),
  };
  const { options, follower } = following(given, table);
  const sessions = { values: () => [...table.entries.values()].map((entry) => entry.opening) };
  const require = (ref: string): Promise<Session> =>
    table.entries.get(ref)?.opening ?? notOpen(options, ref);
  // notebooks.changed follows every command that changed the list, once its change is done.
  const changed = async <T>(done: T): Promise<T> => {
    await options.listChanged();
    return done;
  };
  return {
    create: async (ref) => {
      await afterClose(options, table, ref);
      return changed(await (await exclusive(table, () => createNew(options, table, ref))).opening);
    },
    open: async (ref) => {
      await afterClose(options, table, ref);
      const entered = table.entries.get(ref)?.opening;
      if (entered) return entered;
      const { opening, fresh } = await exclusive(table, () =>
        openNew(options, table, ref, follower),
      );
      return fresh ? changed(await opening) : opening;
    },
    require,
    ...listChanges(options, table),
    summary: (ref) => summaryOf(options, table.entries.get(ref)?.opening, ref),
    closeAll: () => closeEvery(table, follower.stop),
    openRefs: () => [...table.entries.keys()],
    listChanged: () => options.listChanged(),
    fullValue: (execution, index) => fullValueAmong(sessions.values(), execution, index),
    sessions: () => opened(sessions.values()),
    byRealm: async (realmId) =>
      (await opened(sessions.values())).find((session) => session.realm.owns(realmId)),
  };
}

/** The daemon's stop: nothing opens from now on (nor is followed), every session closes, and the closes under way end. */
async function closeEvery(table: Table, stopFollowing: () => void): Promise<void> {
  stopFollowing();
  table.stopping = true;
  const open = [...table.entries.values()].map((entry) => entry.opening);
  table.entries.clear();
  const closes = open.map(async (session) => (await session).close());
  await Promise.allSettled([...closes, ...[...table.closing.values()].map(({ done }) => done)]);
}

/** The sessions that opened; a notebook whose open failed holds nothing (its caller already has the failure). */
async function opened(openings: readonly Promise<Session>[]): Promise<Session[]> {
  const sessions = await Promise.all(openings.map((opening) => opening.catch(() => undefined)));
  return sessions.filter((session) => session !== undefined);
}
