// The daemon's notebook session (02-architecture §2, §4): one per open notebook, holding the notebook file's state, the
// cells' status, the graph and stale flags, the autosave, the kernel and the queries; its parts share its context.
import type { Cell, CellId, NotebookState } from "@jsnb/core";
import { textHash } from "@jsnb/core";

import { identityOf } from "../../files/atomicWrite.js";
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
import type { ExternalOutcome, ExternalState } from "./external.js";
import {
  conflictOn,
  diskNotice,
  externalState,
  ownEdit,
  reconcileExternal,
  staleEdit,
} from "./external.js";
import { savesOutputs, textOf } from "./fileForm.js";
import { moveRecovery } from "../../files/notebooks/recovery.js";
import { recoverOnOpen, recoveryKeeper } from "./recoveryCopy.js";
import { readNotebook } from "../../files/notebooks/notebookFile.js";
import { diffDisk } from "../git/bodies.js";
import { reloadSession } from "./reload.js";
import { disposeDeleted } from "./runs/disposeDeleted.js";
import type { SessionRuns } from "./runApi.js";
import { createRuns } from "./runApi.js";
import type { ErrorsView, GraphView } from "./views.js";
import { errorsOf, graphOf, stateOf } from "./views.js";
import { watchFile } from "./watch.js";

export type { SessionOptions } from "./assemble.js";

export type Session = SessionRuns & {
  /** The notebook's ref now: a followed move or a rename of the open notebook changes it (07 §5). */
  readonly ref: string;
  /** The notebook's file moved to `path`, the ref `to`: its events, kernel log and saves follow, its kernel runs on. */
  readonly moveTo: (to: string, path: string) => Promise<void>;
  /** Settles once a recovery copy left by an earlier session was taken back (07 §7). */
  readonly opened: Promise<void>;
  readonly context: SessionContext;
  readonly state: () => NotebookState;
  readonly cell: (cell: CellId) => Cell;
  readonly add: (input: AddCell, editor: Editor) => Cell;
  readonly update: (input: UpdateCell, editor: Editor) => Cell;
  /** For an edit sent without `base` over a source the file on disk set: what to tell its caller (07 §5). */
  readonly diskNotice: (input: UpdateCell) => string | undefined;
  /** cell.revert: the code from before the agent edits no one reviewed, put back as an edit by `editor`. */
  readonly revert: (cell: CellId, editor: Editor) => Cell;
  readonly markReviewed: (cell: CellId) => Cell;
  readonly move: (cell: CellId, after: CellId | null) => readonly CellId[];
  readonly remove: (cell: CellId) => void;
  readonly save: (force: boolean) => Promise<string>;
  /** notebook.compareDisk: the file on disk against the text a save would write now. */
  readonly compareDisk: (content: boolean) => Promise<ReturnType<typeof diffDisk>>;
  readonly reload: () => Promise<NotebookState>;
  /** A git operation of the app rewrote the file: merged now, as the watch would (07 §5), with merging on or off. */
  readonly mergeDisk: () => Promise<ExternalOutcome>;
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
  const { last, type } = context.cells.require(cell);
  const ended = runs.dropRuns(cell);
  deleteCell(context, cell);
  if (last) context.runs.retained.drop(last.id);
  void disposeDeleted(context, { cell, type }, ended);
}

/** The cell edits of the session, each answered in the API's form. An edit whose base is not the cell's text holds
 * its cell in conflict (external.ts); any other edit of the code ends what the session knew of the
 * file's text for that cell. */
function edits(context: SessionContext, state: ExternalState) {
  const api = (record: Parameters<typeof context.cells.api>[0]) => context.cells.api(record);
  const own = <T extends { readonly id: CellId }>(record: T): T => {
    state.fromDisk.delete(record.id);
    return record;
  };
  return {
    cell: (cell: CellId) => api(context.cells.require(cell)),
    add: (input: AddCell, editor: Editor) => api(addCell(context, input, editor)),
    update: (input: UpdateCell, editor: Editor) => {
      const stale = staleEdit(context, state, input, editor);
      const before = textHash(context.cells.require(input.cell).source);
      const record = updateCell(context, input, editor);
      if (textHash(record.source) !== before)
        ownEdit(context, state, { cell: input.cell, before, stale }, editor);
      if (stale) conflictOn(context, [input.cell], [...state.held.keys()]);
      return api(input.source === undefined && input.type === undefined ? record : own(record));
    },
    revert: (cell: CellId, editor: Editor) => api(own(revertCell(context, cell, editor))),
    markReviewed: (cell: CellId) => api(markReviewed(context, cell)),
    move: (cell: CellId, after: CellId | null) => moveCell(context, cell, after),
  };
}

/** The session's answers to its autosave, set once the session's parts exist. */
type FileHookSlots = {
  run: () => Promise<"merged" | "conflict" | "unreadable" | "off">;
  recovery: (needed: boolean, now?: boolean) => Promise<boolean>;
};

/** The context of a session that knows its file (07 §5): by its identity at open, then by each save's and each
 * read's; a write that finds the file changed asks `external` for the merge. */
function identifiedContext(
  options: SessionOptions,
  hooks: FileHookSlots,
): ReturnType<typeof contextOf> {
  const context = contextOf(options, {
    written: (identity) => {
      context.identity = identity;
    },
    external: () => hooks.run(),
    recovery: (needed, now) => hooks.recovery(needed, now),
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
  if (options.recoveryDir !== undefined)
    await moveRecovery(options.recoveryDir, from, to).catch((error: unknown) => {
      context.log.warn({ err: error, from, to }, "the recovery copy could not follow the notebook");
    });
  context.emit("notebook.moved", { path: from, to });
  options.bus.moveStream(from, to);
  context.ref = to;
  context.path = path;
  context.logPath = kernelLogPath(options.logsDir, to);
  context.log.info({ from, to }, "the notebook's file moved; the session follows it");
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

/** The merge of another program's edits into the session (07 §5), unless files.mergeExternalChanges is off: run by
 * the watch on the file, and by a write that finds the file changed. */
function externalParts(
  options: SessionOptions,
  context: SessionContext,
  parts: {
    readonly runs: SessionRuns;
    readonly hook: FileHookSlots;
  },
) {
  const state = externalState();
  const merge = () => reconcileExternal(context, state, (cell) => void parts.runs.dropRuns(cell));
  const on = () => context.settings()["files.mergeExternalChanges"];
  parts.hook.run = async () => {
    if (!on()) return "off";
    const outcome = await merge();
    return outcome === "conflict" || outcome === "unreadable" ? outcome : "merged";
  };
  const watch = watchFile({
    path: () => context.path,
    log: context.log,
    debounceMs: options.watchDebounceMs ?? 100,
    everyMs: options.fileCheckMs ?? 2000,
    check: async () => {
      if (on()) await context.autosave.exclusive(merge);
    },
  });
  // the app's own git operations: brought in step whatever files.mergeExternalChanges says of other programs' edits
  const mergeNow = (): Promise<ExternalOutcome> => context.autosave.exclusive(merge);
  return { state, watch, mergeNow };
}

/** notebook.reload: the file's text in place of the session's; the cells whose text it changed are the file's (a page
 * edit still made on their old text is a conflict), and the conflict is over. */
async function reloaded(context: SessionContext, state: ExternalState): Promise<void> {
  const before = new Map(
    context.cells.list().map((r) => [r.id, { source: r.source, type: r.type }]),
  );
  await context.autosave.exclusive(() => reloadSession(context)); // after the write under way
  state.held.clear();
  state.order = false;
  for (const record of context.cells.list()) {
    const was = before.get(record.id);
    if (was !== undefined && was.source !== record.source)
      state.fromDisk.set(record.id, { hash: textHash(record.source), before: was });
  }
}

/** notebook.save; a forced one ends the conflict with the session's text. */
async function saved(context: SessionContext, state: ExternalState, force: boolean) {
  const at = await context.autosave.save(force);
  if (force) {
    state.held.clear();
    state.order = false;
  }
  return at;
}

/** notebook.compareDisk: the notebook's file against the text a save would write now. */
async function compareDisk(
  options: SessionOptions,
  context: SessionContext,
  content: boolean,
): Promise<ReturnType<typeof diffDisk>> {
  const read = await readNotebook(context.path);
  const text = sessionText(options, context);
  return diffDisk({ path: context.ref, content }, read.kind === "read" ? read.text : null, text);
}

/** The file text a save would write now. */
function sessionText(options: SessionOptions, context: SessionContext): string {
  const save = savesOutputs(context.settings(), context.header);
  return textOf(context.header, context.cells.list(), { save, redact: options.realm.redact });
}

/** The recovery copy (07 §7): kept by the autosave's hook, taken back at open; `opened` once that is done. */
function recoveryParts(
  options: SessionOptions,
  context: SessionContext,
  parts: { readonly state: ExternalState; readonly hook: FileHookSlots },
): Promise<void> {
  const dir = options.recoveryDir;
  if (dir === undefined) return Promise.resolve();
  const keeper = recoveryKeeper(dir, context, () => sessionText(options, context));
  parts.hook.recovery = keeper.keep;
  return context.autosave
    .exclusive(async () => {
      if (await recoverOnOpen(dir, context, parts.state)) keeper.found();
    })
    .catch((error: unknown) => {
      context.log.warn({ err: error }, "the notebook's recovery copy could not be read");
    });
}

/** The session of an opened notebook; its kernel starts now, without waiting for `ready`. */
export function createSession(options: SessionOptions): Session {
  const hook: FileHookSlots = {
    run: () => Promise.resolve("off"),
    recovery: () => Promise.resolve(false),
  };
  const context = identifiedContext(options, hook);
  void context.kernel.ready().catch(() => undefined); // a failed start is logged and reported as kernel.status dead
  const realm = createRealm(context, options.realm);
  const runs = createRuns(context, realm);
  const query = queryParts(options, context);
  const debug = debuggerOf(options, context);
  const { state, watch, mergeNow } = externalParts(options, context, { runs, hook });
  const opened = recoveryParts(options, context, { state, hook });
  return {
    ...runs,
    get ref() {
      return context.ref;
    },
    opened,
    // the watch rearmed on the new path, the headless page of the old name closed
    moveTo: async (to, path) => {
      await moveSession(options, context, to, path);
      watch.rearm();
      realm.moved();
    },
    context,
    state: () => stateOf(context, realm.status(), debug.state()),
    ...edits(context, state),
    diskNotice: (input) => diskNotice(context, state, input),
    remove: (cell) => {
      removeCell(context, runs, cell);
    },
    save: (force) => saved(context, state, force),
    compareDisk: (content) => compareDisk(options, context, content),
    reload: async () => {
      await reloaded(context, state);
      return stateOf(context, realm.status(), debug.state());
    },
    mergeDisk: mergeNow,
    graph: () => graphOf(context),
    errors: () => errorsOf(context),
    outputQuery: (request) => outputQuery(context, query, request),
    compare: (cell, limit) => compareCell(context, cell, limit),
    exportPage: (request) => exportNotebook(context, request, options.realm.redact),
    realm: { ...realm, restart: runs.restartRealm },
    debug,
    close: async () => {
      watch.close();
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
