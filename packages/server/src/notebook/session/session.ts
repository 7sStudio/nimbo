// The daemon's notebook session (02-architecture §2, §4): one per open notebook, holding the notebook file's state, the
// cells' status, the graph and stale flags, the autosave, the kernel and the queries; its parts share its context.
import type { Cell, CellId, NotebookState } from "@jsnb/core";

import { stat } from "node:fs/promises";

import type { FileIdentity } from "../../files/atomicWrite.js";
import { kernelLogPath } from "../../files/logs/kernelLog.js";
import { DebugSession } from "../debug/session.js";
import type { SessionRealm } from "../realm/realm.js";
import { createRealm } from "../realm/realm.js";
import { heldKey } from "../query/engines.js";
import type { OutputQueryAnswer, OutputQueryRequest, QueryParts } from "../query/session.js";
import { outputQuery } from "../query/session.js";
import { createSqlTables } from "../query/sql.js";
import type { SessionOptions } from "./assemble.js";
import { contextOf } from "./assemble.js";
import type { SessionContext } from "./context.js";
import type { AddCell, UpdateCell } from "./edits.js";
import { addCell, deleteCell, markReviewed, moveCell, revertCell, updateCell } from "./edits.js";
import type { Editor } from "./provenance.js";
import type { ExportRequest } from "./exported.js";
import { compareCell, exportNotebook } from "./exported.js";
import { reloadSession } from "./reload.js";
import { disposeDeleted } from "./runs/disposeDeleted.js";
import type { SessionRuns } from "./runApi.js";
import { createRuns } from "./runApi.js";
import type { ErrorsView, GraphView } from "./views.js";
import { errorsOf, graphOf, stateOf } from "./views.js";

export type { SessionOptions } from "./assemble.js";

export type Session = SessionRuns & {
  /** The notebook's ref now: a followed move or a rename of the open notebook changes it (07 §5). */
  readonly ref: string;
  /** The notebook's file moved to `path`, the ref `to`: its events, kernel log and saves follow, its kernel runs on. */
  readonly moveTo: (to: string, path: string) => Promise<void>;
  readonly context: SessionContext;
  readonly state: () => NotebookState;
  readonly cell: (cell: CellId) => Cell;
  readonly add: (input: AddCell, editor: Editor) => Cell;
  readonly update: (input: UpdateCell, editor: Editor) => Cell;
  /** cell.revert: the code from before the agent edits no one reviewed, put back as an edit by `editor`. */
  readonly revert: (cell: CellId, editor: Editor) => Cell;
  readonly markReviewed: (cell: CellId) => Cell;
  readonly move: (cell: CellId, after: CellId | null) => readonly CellId[];
  readonly remove: (cell: CellId) => void;
  readonly save: (force: boolean) => Promise<string>;
  readonly reload: () => Promise<NotebookState>;
  /** Reads the file again unless the notebook holds edits not on disk (checked once the file is read, with no wait
   * before the reconcile); false when it held some and nothing changed. */
  readonly reloadUnlessEdited: () => Promise<boolean>;
  readonly graph: () => GraphView;
  readonly errors: () => ErrorsView;
  readonly outputQuery: (request: OutputQueryRequest) => Promise<OutputQueryAnswer>;
  /** cell.compare: the cell's last run against the one before it. */
  readonly compare: (cell: CellId, limit: number) => ReturnType<typeof compareCell>;
  /** notebook.export: the notebook as one HTML page, written into the workspace when a path is given. */
  readonly exportPage: (request: ExportRequest) => Promise<{ html: string; path?: string }>;
  /** The page that runs its client cells, the bridge calls into its kernel; its `restart` is realm.restart: the queued client runs end, then the page's full reset, every
   * client cell idle with no outputs (03-api §4.5). */
  readonly realm: SessionRealm & { readonly restart: () => Promise<void> };
  /** The notebook's debugger (03-api §4.9). */
  readonly debug: DebugSession;
  readonly close: () => Promise<void>;
};

/**
 * The session's query engines: the daemon's JSON ones and its own SQL tables, both letting a value go with its
 * retention (its SQL table, what the JSON engines hold under its key).
 */
function queryParts(options: SessionOptions, context: SessionContext): QueryParts {
  const sql = createSqlTables(options.sqlDirectory);
  context.runs.retained.onDrop((value) => {
    sql.forget(`${value.execution}:${String(value.index)}`);
    options.engines.release(heldKey(context.holdKey, value.execution, value.index));
  });
  return { engines: options.engines, sql };
}

/** cell.delete: the cell goes, and the full values of its last run with it; its runs end first, the queued ones
 * unstarted and the one under way as an interrupt ends it, the page's run of it whatever its type became; once that
 * interrupt settled, the kernel runs the cell's disposers, so its routes and timers end with it. */
function removeCell(
  context: SessionContext,
  runs: Pick<SessionRuns, "dropRuns">,
  cell: CellId,
): void {
  const last = context.cells.require(cell).last;
  const ended = runs.dropRuns(cell);
  deleteCell(context, cell);
  if (last) context.runs.retained.drop(last.id);
  void disposeDeleted(context, cell, ended);
}

/** The cell edits of the session, each answered in the API's form. */
function edits(context: SessionContext) {
  const api = (record: Parameters<typeof context.cells.api>[0]) => context.cells.api(record);
  return {
    cell: (cell: CellId) => api(context.cells.require(cell)),
    add: (input: AddCell, editor: Editor) => api(addCell(context, input, editor)),
    update: (input: UpdateCell, editor: Editor) => api(updateCell(context, input, editor)),
    revert: (cell: CellId, editor: Editor) => api(revertCell(context, cell, editor)),
    markReviewed: (cell: CellId) => api(markReviewed(context, cell)),
    move: (cell: CellId, after: CellId | null) => moveCell(context, cell, after),
  };
}

/** The identity of the file at `path`, undefined when it cannot be read. */
const identityOf = (path: string): Promise<FileIdentity | undefined> =>
  stat(path).then(
    (stats) => ({ dev: stats.dev, ino: stats.ino }),
    () => undefined,
  );

/** The context of a session that knows its file (07 §5): by its identity at open, then by each save's. */
function identifiedContext(options: SessionOptions): ReturnType<typeof contextOf> {
  const context = contextOf(options, {
    written: (identity) => {
      context.identity = identity;
    },
    ...(options.missing ? { missing: options.missing } : {}),
  });
  void identityOf(options.path).then((identity) => {
    context.identity ??= identity; // a save that came first knows better
  });
  return context;
}

/** The notebook's file moved to `path` (ref `to`): the log first, then notebook.moved on the old stream, whose
 * subscribers follow it to `to`, then the context's ref and path. */
async function moveSession(
  options: SessionOptions,
  context: ReturnType<typeof contextOf>,
  to: string,
  path: string,
): Promise<void> {
  const from = context.ref;
  await context.moveLog(to);
  context.emit("notebook.moved", { path: from, to });
  options.bus.moveStream(from, to);
  Object.assign(context, { ref: to, path, logPath: kernelLogPath(options.logsDir, to) });
  context.log.info({ from, to }, "the notebook's file moved; the session follows it");
}

/** What a session answers from its state without changing it: the graph, the errors, a query, a comparison, the page. */
function readers(
  options: SessionOptions,
  context: ReturnType<typeof contextOf>,
  query: ReturnType<typeof queryParts>,
) {
  return {
    graph: () => graphOf(context),
    errors: () => errorsOf(context),
    outputQuery: (request: Parameters<Session["outputQuery"]>[0]) =>
      outputQuery(context, query, request),
    compare: (cell: CellId, limit: number) => compareCell(context, cell, limit),
    exportPage: (request: ExportRequest) => exportNotebook(context, request, options.realm.redact),
  };
}

/** The notebook's debugger, which a server run waits for and a client cell's compile asks for its lines. */
function debuggerOf(options: SessionOptions, context: SessionContext): DebugSession {
  const debug = new DebugSession(context, {
    adapter: options.debugAdapter,
    listen: options.bus.listen,
    redact: options.realm.redact,
  });
  context.hooks.beforeServerRun = () => debug.beforeRun();
  context.hooks.debuggerLines = (cell) => debug.clientLines(cell);
  context.hooks.debugPause = () => debug.pauseDetails();
  context.hooks.debugResumed = () => debug.resumed();
  return debug;
}

/** notebook.reload: after the write under way. */
const reloaded = (context: Session["context"]): Promise<boolean> =>
  context.autosave.exclusive(() => reloadSession(context));

/** notebook.reload for a git operation: skipped, with no wait between the check and the reconcile, when the notebook
 * holds edits not on disk. */
const reloadUnlessEdited = (context: Session["context"]): Promise<boolean> =>
  context.autosave.exclusive(() => reloadSession(context, () => context.autosave.state().mutated));

/** The session of an opened notebook; its kernel starts now, without waiting for `ready`. */
export function createSession(options: SessionOptions): Session {
  const context = identifiedContext(options);
  void context.kernel.ready().catch(() => undefined); // a failed start is logged and reported as kernel.status dead
  const realm = createRealm(context, options.realm);
  const runs = createRuns(context, realm);
  const query = queryParts(options, context);
  const debug = debuggerOf(options, context);
  return {
    ...runs,
    get ref() {
      return context.ref;
    },
    moveTo: (to, path) => moveSession(options, context, to, path),
    context,
    state: () => stateOf(context, realm.status(), debug.state()),
    ...edits(context),
    remove: (cell) => {
      removeCell(context, runs, cell);
    },
    save: (force) => context.autosave.save(force),
    reloadUnlessEdited: () => reloadUnlessEdited(context),
    reload: () => reloaded(context).then(() => stateOf(context, realm.status(), debug.state())),
    ...readers(options, context, query),
    realm: { ...realm, restart: runs.restartRealm },
    debug,
    close: async () => {
      await debug.close();
      await context.autosave.flush();
      context.autosave.close();
      realm.close();
      await runs.stop();
      context.runs.retained.clear(); // what the JSON engines hold of this notebook goes with it
      await query.sql.dispose();
      context.closeLog();
      context.emit("notebook.closed", { path: context.ref });
    },
  };
}
