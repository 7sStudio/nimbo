// A client cell's run: the transform and the pre-flight of uninstalled packages; the kernel's snapshot of the server exports
// the cell uses (not those the page's own cells define), the names it cannot bind with their errors (the page ends the
// run with the first it does not resolve itself), then realm.execute to the attached page with those bindings, the
// public env and the run's limits, both read again per run. The page's realm.report calls
// carry the outputs and the terminal status, and its answer ends the wait; a page that goes away (detach, closed
// socket) or a kernel.interrupt ends the run `interrupted`.
import type { RealmLimits, Settings, SnapshotBinding } from "@jsnb/core";
import { afterRun, JsnbError, MissingPackage, RealmNotAttached } from "@jsnb/core";
import { missingPackages } from "@jsnb/kernel-node";

import { withTimeout } from "../../kernel/requests.js";
import { timerMs } from "../../kernel/timers.js";
import type { SessionContext } from "../session/context.js";
import { restale } from "../session/edits.js";
import type { ExecutionRecord } from "../session/records.js";
import { terminalStatuses } from "../session/records.js";
import { runError } from "../session/runs/errors.js";
import { finish, setStatus } from "../session/runs/executions.js";
import { compileCell } from "../session/runs/server.js";
import type { Resolution } from "./names.js";
import { resolveNames } from "./names.js";
import type { Attachment, RealmDeps, RealmState } from "./state.js";
import { hold, noteFinished } from "./state.js";

/** The settings a client run applies in the page, the timeout clamped as the daemon's own (kernel/timers.ts). */
const limitsOf = (settings: Settings): RealmLimits => ({
  rpcTimeoutMs: timerMs(settings["bridge.rpcTimeoutMs"]),
  maxBytesPerValue: settings["bridge.maxBytesPerValue"],
  maxValueBytes: settings["outputs.maxValueBytes"],
  maxStreamBytes: settings["outputs.maxStreamBytes"],
});

const failWith = (context: SessionContext, execution: ExecutionRecord, error: unknown): void => {
  finish(context, execution, {
    status: "error",
    durationMs: 0,
    error: runError(error, execution.cell),
  });
};

/** The kernel's snapshot of `names`, with a timeout of the daemon's own; a stopped run stops
 * waiting for it at once (the kernel drops the request, or its late result). */
async function snapshotOf(
  context: SessionContext,
  names: readonly string[],
  stop: AbortSignal,
): Promise<Record<string, SnapshotBinding>> {
  if (names.length === 0) return {};
  const kernel = await context.kernel.ready();
  stop.throwIfAborted();
  const maxBytesPerValue = context.settings()["bridge.maxBytesPerValue"]; // the setting now, not the launch one
  return withTimeout(
    "snapshot",
    context.requestTimeoutMs,
    (signal) => kernel.snapshot(names, { signal, maxBytesPerValue }),
    { caller: stop, pauses: context.kernel.pauses },
  );
}

/** What a run reads when the page holding it went away during it, by the detach's reason (attach.ts). */
const goneWords: Readonly<Record<string, string>> = {
  socket: "the page running it closed or lost its connection",
  takenOver: "another tab took the notebook's client realm over",
  detached: "the page running it detached",
  "headless:gone": "the headless browser running it exited",
  "headless:socket":
    "the headless page running it lost its connection (its browser exited, or the page closed)",
  "headless:detached": "the headless page running it went away",
  "headless:unresponsive":
    "the headless page did not answer and was closed (a client cell kept it busy)",
  "headless:turned off": "realm.headless was turned off",
  "headless:moved": "the notebook moved",
  "headless:closed": "the notebook closed",
  "headless:idle": "the headless page closed after realm.headlessIdleMs unused",
};

/** The error of a run cut because its page went away, or undefined when it did not (an interrupt, a restart). */
function pageGone(context: SessionContext, attachment: Attachment): JsnbError | undefined {
  if (!gone(attachment)) return undefined;
  const given: unknown = attachment.detached.signal.reason;
  const reason = given === "socket" && attachment.kind === "headless" ? "headless:socket" : given;
  const why = (typeof reason === "string" ? goneWords[reason] : undefined) ?? goneWords.socket;
  return new JsnbError({
    name: "PageGone",
    message: `The cell stopped: ${String(why)}. Run it again.`,
    data: { notebook: context.ref, reason: typeof reason === "string" ? reason : "socket" },
  });
}

/** The page detached or its socket closed. */
const gone = (attachment: Attachment): boolean =>
  attachment.detached.signal.aborted || attachment.page.closed.aborted;

/** What the page is sent: the transform's code and map, and the server names it binds or cannot. */
type Sent = {
  readonly execution: ExecutionRecord;
  readonly code: string;
  readonly map: string;
  readonly resolution: Resolution;
};

/** Where a client run goes, how it is stopped, and when it started (`performance.now()`). */
type Where = {
  readonly attachment: Attachment;
  readonly stop: AbortSignal;
  readonly startedAt: number;
};

/** Snapshot, env, limits, realm.execute; the run's end once the page answered, or why it failed. */
async function execute(
  context: SessionContext,
  deps: RealmDeps,
  where: Where,
  sent: Sent,
): Promise<void> {
  const { execution, resolution } = sent;
  const { attachment, stop } = where;
  const interrupted = (): void => {
    const away = pageGone(context, attachment);
    finish(context, execution, {
      status: "interrupted",
      durationMs: performance.now() - where.startedAt,
      ...(away === undefined ? {} : { error: runError(away, execution.cell) }),
    });
  };
  // an interrupt, the page's going or a kernel restart while the kernel took the snapshot: the run never starts, and
  // ends `interrupted` as the queued runs a restart clears do (a restart's snapshot failure is not the cell's error)
  const restarts = context.runs.restarts;
  const cut = (): boolean => stop.aborted || gone(attachment) || context.runs.restarts !== restarts;
  try {
    const bindings = await snapshotOf(context, resolution.names, stop);
    const env = await deps.publicEnv();
    if (terminalStatuses.has(execution.status)) return;
    if (cut()) {
      interrupted();
      return;
    }
    setStatus(context, execution, "running");
    const signal = AbortSignal.any([attachment.detached.signal, stop]);
    // the run, its bindings, the public env, its limits and the names it cannot bind
    const params = {
      execution: execution.id,
      cell: execution.cell,
      code: sent.code,
      map: sent.map,
      bindings,
      env,
      limits: limitsOf(context.settings()),
      ...(Object.keys(resolution.unbound).length > 0 ? { unbound: resolution.unbound } : {}),
    };
    await attachment.page.request("realm.execute", params, signal);
    // The page answers after its status report; no status means it dropped the run (a reset, a detach), and its own
    // `interrupted` report, which comes after this answer whenever another report was ahead of it, is dropped
    // (reports.ts).
    if (!terminalStatuses.has(execution.status)) interrupted();
  } catch (error) {
    if (terminalStatuses.has(execution.status)) return;
    if (cut()) interrupted();
    else failWith(context, execution, error);
  }
}

/** Runs a client cell to its terminal status on the attached page, once `ensure` (the headless realm's) settled: its
 * failure is the run's. */
export async function runClientCell(
  context: SessionContext,
  state: RealmState,
  deps: RealmDeps,
  run: { readonly execution: ExecutionRecord; readonly ensure: () => Promise<void> },
): Promise<void> {
  const { execution } = run;
  const unready = await run.ensure().then(
    () => undefined,
    (error: unknown) => error,
  );
  if (terminalStatuses.has(execution.status)) return; // ended while the headless page started
  if (unready !== undefined) {
    failWith(context, execution, unready);
    return;
  }
  if (state.attachment?.kind === "headless") await context.hooks.beforeClientRun(execution.cell);
  if (terminalStatuses.has(execution.status)) return;
  const attachment = state.attachment;
  if (!attachment) {
    failWith(context, execution, new RealmNotAttached({ notebook: context.ref }));
    return;
  }
  const prepared = compileCell(context, context.cells.require(execution.cell));
  if (!prepared.ok) {
    finish(context, execution, prepared.ending);
    return;
  }
  const { code, map, analysis } = prepared.compiled;
  // The pre-flight of a server run: the page would only see its import fail to fetch, with no name.
  const missing = missingPackages(context.root, analysis.imports);
  if (missing.length > 0) {
    failWith(context, execution, new MissingPackage({ names: missing }));
    return;
  }
  execution.defines = analysis.defines;
  const resolution = resolveNames(context, state, execution.cell, analysis);
  hold(state, resolution.names);
  const stop = { controller: new AbortController(), startedAt: performance.now() };
  state.running.set(execution.id, execution);
  state.stops.set(execution.id, stop);
  try {
    const where = { attachment, stop: stop.controller.signal, startedAt: stop.startedAt };
    await execute(context, deps, where, { execution, code, map, resolution });
  } finally {
    state.running.delete(execution.id);
    state.stops.delete(execution.id);
    noteFinished(state, execution.id);
  }
  if (execution.status === "ok")
    restale(context, afterRun(context.cells.graph(), context.cells.stale(), execution.cell));
}
