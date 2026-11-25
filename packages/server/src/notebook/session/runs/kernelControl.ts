// kernel.interrupt and kernel.restart of 03-api §4.4 and 04-kernel §6: an interrupt clears the queue (the queued runs
// end `interrupted`), stops the running server cell through the kernel's inspector, raced with a timeout of the
// daemon's own, since a kernel inside a synchronous native call answers late (a refusal, INTERRUPT_REFUSED, is the
// call's failure, the run already ended), and ends a running client cell through the page (02-architecture §5). A
// restart kills and respawns: every server cell idle, the stale flags reset; it waits for a running server run to end,
// never for a client run, which the page runs.
import type { CellId, ExecutionId } from "@jsnb/core";
import { afterKernelRestart } from "@jsnb/core";
import type { NodeKernel } from "@jsnb/kernel-node";

import type { SessionContext } from "../context.js";
import { restale } from "../edits.js";
import type { ExecutionRecord } from "../records.js";
import { cancel } from "./execute.js";
import type { QueuedRun, RunQueue } from "./queue.js";

/** How long kernel.interrupt waits for the kernel's hook before answering (the run has ended already). */
const interruptWaitMs = 1000;

/** Ends a run taken off the queue unstarted, `interrupted`, and answers whoever waits for it at once, so a waiting
 * cell.run does not wait out its timeoutMs. */
function endUnstarted(context: SessionContext, run: QueuedRun): void {
  cancel(context, run.execution);
  run.settle();
}

/** Ends every queued run unstarted. */
export function clearQueue(context: SessionContext, queue: RunQueue): void {
  for (const run of queue.take()) endUnstarted(context, run);
}

/** realm.restart (03-api §4.5): the client runs waiting in the queue end unstarted before the page's full reset, so none
 * runs in the fresh page with its cell already idle, and whoever waits for one is answered at once (03-api §4.3.1); the
 * queued server runs stay. */
export function clearClientRuns(context: SessionContext, queue: RunQueue): void {
  const client = (run: QueuedRun): boolean =>
    context.cells.get(run.execution.cell)?.type === "client";
  for (const run of queue.take(client)) endUnstarted(context, run);
}

/** kernel.interrupt()'s settlement, or nothing once `interruptWaitMs` passed; its later outcome is only logged. */
async function interruptWithin(context: SessionContext, kernel: NodeKernel): Promise<void> {
  const interrupt = kernel.interrupt();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => {
      resolve("late");
    }, interruptWaitMs);
  });
  try {
    if ((await Promise.race([interrupt, late])) === "late") {
      context.log.warn(
        {},
        "the kernel's interrupt hook did not answer in time; it may be inside a native call",
      );
      interrupt.catch((error: unknown) => {
        context.log.warn({ err: error }, "the late interrupt failed");
      });
    }
  } finally {
    clearTimeout(timer);
  }
}

/** The page's side of an interrupt: whether it runs an execution, and the ending of one it runs (false when the page
 * had finished it already). */
export type ClientInterrupts = {
  readonly runs: (execution: ExecutionId) => boolean;
  readonly interrupt: (execution: ExecutionRecord) => Promise<boolean>;
};

/** A server run not sent to the kernel yet (its kernel still starts, or it waits for the debugger to attach) holds no
 * execution the kernel's hook could end: it ends before it executes. */
function endUnsent(context: SessionContext, running: ExecutionRecord): void {
  if (running.cell !== context.kernel.status().executing) cancel(context, running);
}

/**
 * kernel.interrupt: the queue cleared, the kernel's running user code stopped (a cell's run, a bridge call, or a
 * callback a cell left behind) and a client run the page runs ended by `client`, whatever its cell became since (deleted,
 * or of another type); answers the cell whose run was stopped, or null. The page's ending is awaited even when the
 * kernel's interrupt fails (INTERRUPT_REFUSED).
 */
export async function interruptRuns(
  context: SessionContext,
  queue: RunQueue,
  client: ClientInterrupts,
): Promise<CellId | null> {
  clearQueue(context, queue);
  const running = queue.running()?.execution;
  const page = running && client.runs(running.id) ? client.interrupt(running) : undefined;
  if (running && page === undefined) endUnsent(context, running);
  const kernel = context.kernel.live();
  let ended = true;
  try {
    if (kernel) {
      await interruptWithin(context, kernel);
      await context.hooks.debugResumed();
    }
  } finally {
    if (page) ended = await page;
  }
  return running && ended ? running.cell : null;
}

/** Logs an interrupt of a deleted cell's run that failed: the kernel.interrupt command remains. */
const logFailed =
  (context: SessionContext, cell: CellId) =>
  (error: unknown): void => {
    context.log.warn({ err: error, cell }, "the interrupt of a deleted cell's run failed");
  };

/**
 * cell.delete of a cell that has runs: its queued runs end unstarted, whoever waits for them answered at once; its
 * run under way ends as an interrupt ends it: the page's run through `client`, whatever the cell's type became since
 * (the realm says whether the page runs it, 02-architecture §5), a server run executing now through the kernel, so the
 * kernel never stays busy with a cell that is gone, and one not executing yet before it executes. The other cells' runs
 * are left alone. Settles once the interrupt it sent did, and never rejects: a failed interrupt is logged.
 */
function dropCellRuns(
  context: SessionContext,
  queue: RunQueue,
  client: ClientInterrupts,
  cell: CellId,
): Promise<void> {
  for (const run of queue.take((each) => each.execution.cell === cell)) endUnstarted(context, run);
  const running = queue.running()?.execution;
  if (running?.cell !== cell) return Promise.resolve();
  if (client.runs(running.id)) {
    return client.interrupt(running).then(() => undefined, logFailed(context, cell));
  }
  const kernel = context.kernel.live();
  if (kernel && context.kernel.status().executing === cell)
    return interruptWithin(context, kernel).catch(logFailed(context, cell));
  // not executing yet (its kernel still starts, or the run is still being prepared): it ends before it executes
  cancel(context, running);
  return Promise.resolve();
}

/** dropCellRuns over one session's queue and page: SessionRuns.dropRuns. */
export const cellRunsDropper =
  (context: SessionContext, queue: RunQueue, client: ClientInterrupts) =>
  (cell: CellId): Promise<void> =>
    dropCellRuns(context, queue, client, cell);

/**
 * kernel.restart: SIGKILL and a fresh kernel; a running server run ends `interrupted` (a client run is the page's and
 * goes on: the restart never waits for it, whatever its cell became since, as the realm, `runs`, says), server cells
 * idle, flags reset.
 */
export async function restartKernel(
  context: SessionContext,
  queue: RunQueue,
  runs: ClientInterrupts["runs"],
): Promise<void> {
  context.runs.restarts += 1;
  context.runs.executions = 0;
  clearQueue(context, queue);
  const running = queue.running();
  const serverRun = running && !runs(running.execution.id) ? running : undefined;
  context.runs.ending = true;
  try {
    await context.kernel.restart();
    await serverRun?.done;
  } finally {
    context.runs.ending = false;
  }
  for (const record of context.cells.list()) {
    if (record.type !== "server" || record.status === "idle") continue;
    if (record.last && runs(record.last.id)) continue; // retyped while the page runs it: that run's status stands
    record.status = "idle";
    if (record.last)
      context.emit("cell.status", { cell: record.id, execution: record.last.id, status: "idle" });
  }
  restale(context, afterKernelRestart(context.cells.graph(), context.cells.stale()));
}
