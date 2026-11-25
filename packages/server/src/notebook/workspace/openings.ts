// The files behind notebook.open and notebook.create (03-api §4.2, 07-file-format §2, §4): a session over a file's text
// (announced with notebook.opened), an empty notebook written only where none exists and removed again when its session
// cannot start, and NOTEBOOK_NOT_FOUND for a ref no session holds ("is not open" when its file exists).
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { IdGenerator, Settings } from "@jsnb/core";
import { NotebookExists, NotebookNotFound } from "@jsnb/core";
import type { KernelEntry } from "@jsnb/kernel-node";

import type { Adapter } from "../../kernel/debug/adapter.js";
import type { EventBus } from "../../events/bus.js";
import type { Log } from "../../events/log.js";

import { notebookPath, readNotebook } from "../../files/notebooks/notebookFile.js";
import type { JsonEngines } from "../query/engines.js";
import type { RealmDeps } from "../realm/state.js";
import { emptyHeader, loadDocument, textOf } from "../session/fileForm.js";
import type { Session } from "../session/session.js";
import { createSession } from "../session/session.js";
import { NotebookUnwritable } from "./openErrors.js";

export type NotebooksOptions = {
  readonly root: string;
  readonly logsDir: string;
  readonly bus: EventBus;
  readonly log: Log;
  readonly ids: IdGenerator;
  readonly now: () => Date;
  readonly settings: () => Settings;
  readonly port: () => number;
  readonly kernelEntry: KernelEntry | undefined;
  readonly engines: JsonEngines;
  readonly sqlDirectory: string;
  readonly realm: RealmDeps;
  readonly requestTimeoutMs: number;
  readonly debugAdapter: Adapter;
  /** Announces the workspace's notebook list after a command changed it (notebooks.changed); never rejects. */
  readonly listChanged: () => Promise<void>;
  /** Where the notebooks' recovery copies live (07 §7). */
  readonly recoveryDir?: string;
  /** How often each open notebook's file is checked for a move (moves.ts, 07 §5) and stat'ed for an external edit
   * (watch.ts); 2 s by default, 0 for never. */
  readonly moveCheckMs?: number;
  /** Follows a session's file that left its path (set by createNotebooks for the sessions it opens). */
  readonly follow?: (session: Session) => Promise<void>;
};

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

/** A session over the text of `ref`, announced with notebook.opened. */
function start(options: NotebooksOptions, ref: string, path: string, text: string): Session {
  const loaded = loadDocument(text, ref, options.ids);
  for (const warning of loaded.warnings) options.log.warn({ notebook: ref }, warning);
  const missing = async (): Promise<void> => {
    await options.follow?.(session);
  };
  const session: Session = createSession({
    ...options,
    ref,
    path,
    loaded,
    fileText: text,
    missing,
    ...(options.moveCheckMs === undefined ? {} : { fileCheckMs: options.moveCheckMs }),
  });
  options.bus.emit(ref, "notebook.opened", { path: ref });
  return session;
}

/** notebook.open of a notebook that is not open yet. */
export async function load(options: NotebooksOptions, ref: string, path: string): Promise<Session> {
  const read = await readNotebook(path);
  if (read.kind === "missing") throw new NotebookNotFound({ path: ref });
  const session = start(options, ref, path, read.text);
  await session.opened; // a recovery copy is a conflict before anyone reads the notebook
  return session;
}

/**
 * notebook.create's file: an empty notebook only when none exists, its folder created inside the workspace; one that
 * cannot be written (a full disk, a folder that refuses writes) is NotebookUnwritable, and no file is left behind.
 */
export async function writeEmpty(path: string, ref: string): Promise<string> {
  const text = textOf(emptyHeader(), []);
  const unwritable = (error: unknown): NotebookUnwritable => {
    const code = codeOf(error);
    return new NotebookUnwritable(
      { path: ref, code: typeof code === "string" ? code : "EIO" },
      { cause: error },
    );
  };
  // A folder that cannot be made (a file in its place answers EEXIST here) is no notebook that exists.
  await mkdir(dirname(path), { recursive: true }).catch((error: unknown) => {
    throw unwritable(error);
  });
  try {
    await writeFile(path, text, { flag: "wx" });
  } catch (error) {
    if (codeOf(error) === "EEXIST") throw new NotebookExists({ path: ref });
    await rm(path, { force: true }); // what the failed write left (an empty file on a full disk)
    throw unwritable(error);
  }
  return text;
}

/** The session over a file notebook.create just wrote; the file is removed again when the session cannot start. */
export async function startCreated(
  options: NotebooksOptions,
  where: { readonly ref: string; readonly path: string },
  text: string,
): Promise<Session> {
  try {
    return start(options, where.ref, where.path, text);
  } catch (error) {
    await rm(where.path, { force: true });
    throw error;
  }
}

/** NOTEBOOK_NOT_FOUND for a ref no session holds: "is not open" when its file exists. */
export async function notOpen(options: NotebooksOptions, ref: string): Promise<never> {
  const path = await notebookPath(options.root, ref);
  const exists = await stat(path).then(
    (stats) => stats.isFile(),
    () => false, // nothing readable there: the notebook does not exist
  );
  throw new NotebookNotFound(exists ? { path: ref, closed: true } : { path: ref });
}
