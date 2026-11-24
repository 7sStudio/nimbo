// The run commands of 03-api §4.3.1 and §4.2 on a session: cell.run queues a run and, with `wait`, answers at its
// terminal status or at `timeoutMs` (`timedOut: true`, the run going on; a timeout is not an error); notebook.run
// queues the selected cells in notebook order (markdown left out, client cells with no page listed as skipped) and
// stops after an error when asked. A client cell run with no page is the call failure REALM_NOT_ATTACHED.
import type { AutoRunReport, CellId, DebugPause, Execution, Selection } from "@jsnb/core";
import { RealmNotAttached, resolveSelection } from "@jsnb/core";

import type { SessionContext } from "../context.js";
import type { Editor } from "../provenance.js";
import type { ExecutionRecord } from "../records.js";
import { terminalStatuses, toExecution } from "../records.js";
import type { AutoRun } from "./autoRun.js";
import { reportOf } from "./autoRun.js";
import { createExecution } from "./executions.js";
import type { Batch, RunQueue } from "./queue.js";
import { queuedRun } from "./queue.js";
import { pausableTimer } from "../../../kernel/pauses.js";

export type Waiting = {
  readonly wait: boolean;
  readonly timeoutMs: number;
  /** The connection that asked for the run, recorded on its execution. */
  readonly by?: Editor;
  /** cell.run: the answer waits for the dependents the run started too (execution.autoRunDependents). */
  readonly waitAutoRun?: boolean;
};

export type Runs = {
  readonly queue: RunQueue;
  readonly autoRun: AutoRun;
  /** Whether a page is attached to run client cells. */
  readonly realmAttached: () => boolean;
};

/** How a caller's wait for a run ended: the run settled, the time ran out, or the kernel is paused in the debugger. */
type Waited = { readonly late: boolean; readonly paused?: DebugPause };

/** Waits for `done` at most `timeoutMs`, and no longer than until the kernel is paused in the debugger: a paused
 * kernel runs nothing until someone resumes it, which the caller may be the one to do. */
async function waited(
  context: SessionContext,
  done: Promise<void>,
  timeoutMs: number,
): Promise<Waited> {
  const { pauses } = context.kernel;
  let timer: { readonly stop: () => void } | undefined;
  let stopListening: (() => void) | undefined;
  const late = new Promise<Waited>((resolve) => {
    timer = pausableTimer(timeoutMs, pauses, () => {
      resolve({ late: true });
    });
  });
  // a pause the debugger resumes on its own (a step left over from an ended run) is not one to answer on
  const paused = new Promise<Waited>((resolve) => {
    const heard = async (): Promise<void> => {
      const pause = await context.hooks.debugPause();
      if (pauses.paused()) resolve({ late: true, paused: pause });
    };
    stopListening = pauses.onPause(() => void heard());
    if (pauses.paused()) void heard();
  });
  try {
    return await Promise.race([done.then(() => ({ late: false })), late, paused]);
  } finally {
    timer?.stop();
    stopListening?.();
  }
}

/** The answer's form of a run: `timedOut` when the wait ended first, with where the kernel is paused when it is. */
const answer = (execution: ExecutionRecord, wait: Waited): Execution =>
  wait.late && !terminalStatuses.has(execution.status)
    ? {
        ...toExecution(execution),
        timedOut: true,
        ...(wait.paused === undefined ? {} : { paused: wait.paused }),
      }
    : toExecution(execution);

/** The record of who asked: the editor's client and agent name. */
const requester = (by: Editor | undefined): ExecutionRecord["requestedBy"] =>
  by === undefined
    ? undefined
    : { client: by.client, ...(by.agent === undefined ? {} : { agent: by.agent }) };

/** Queues a run of `cell` (part of `batch`) asked for by `by`, returning its record and terminal promise. */
function enqueue(
  context: SessionContext,
  runs: Runs,
  cell: CellId,
  options: {
    readonly batch?: Batch | undefined;
    readonly by?: Editor | undefined;
    readonly trigger?: boolean;
  } = {},
) {
  const record = context.cells.require(cell);
  const execution = createExecution(context, cell, record.analysis.defines, {
    requestedBy: requester(options.by),
  });
  const run = queuedRun(execution, options.batch, options.trigger);
  runs.queue.push(run);
  return run;
}

export type CellRunAnswer = { readonly execution: Execution; readonly autoRun?: AutoRunReport };

/** cell.run (after the session applied `source`, when given); `trigger` false for a run that starts no cascade
 * (cell.add's). */
export async function runCell(
  context: SessionContext,
  runs: Runs,
  cell: CellId,
  waiting: Waiting & { readonly trigger?: boolean },
): Promise<CellRunAnswer> {
  const record = context.cells.require(cell);
  if (record.type === "client" && !runs.realmAttached())
    throw new RealmNotAttached({ notebook: context.ref });
  const run = enqueue(context, runs, cell, { by: waiting.by, trigger: waiting.trigger ?? true });
  if (!waiting.wait) return { execution: toExecution(run.execution) };
  const all =
    waiting.waitAutoRun === true ? run.done.then(() => runs.autoRun.ticket(run)?.done) : run.done;
  const wait = await waited(context, all, waiting.timeoutMs);
  const ticket = runs.autoRun.ticket(run);
  return {
    execution: answer(run.execution, wait),
    ...(ticket === undefined
      ? {}
      : { autoRun: reportOf(ticket, (execution) => answer(execution, wait)) }),
  };
}

export type NotebookRun = Waiting & { readonly select: Selection; readonly stopOnError: boolean };

export type NotebookRunAnswer = {
  readonly executions: Execution[];
  readonly skipped: { readonly cell: CellId; readonly code: "REALM_NOT_ATTACHED" }[];
};

/** notebook.run. */
export async function runNotebook(
  context: SessionContext,
  runs: Runs,
  input: NotebookRun,
): Promise<NotebookRunAnswer> {
  const { cells } = context;
  const selected = resolveSelection(
    { order: cells.order(), graph: cells.graph(), stale: cells.stale() },
    input.select,
  );
  const batch: Batch = { stopped: false };
  const skipped: NotebookRunAnswer["skipped"] = [];
  const queued = [];
  for (const id of selected) {
    const type = cells.require(id).type;
    if (type === "markdown") continue;
    if (type === "client" && !runs.realmAttached())
      skipped.push({ cell: id, code: "REALM_NOT_ATTACHED" });
    else
      queued.push(
        enqueue(context, runs, id, { batch: input.stopOnError ? batch : undefined, by: input.by }),
      );
  }
  const all = Promise.all(queued.map((run) => run.done)).then(() => undefined);
  const wait = input.wait ? await waited(context, all, input.timeoutMs) : { late: false };
  return { executions: queued.map((run) => answer(run.execution, wait)), skipped };
}
