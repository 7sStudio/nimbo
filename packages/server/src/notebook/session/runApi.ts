// The run side of a session: its queue and the commands over it, the outputs
// and full values of the runs, and the kernel's answers; a late output (a timer's, a route handler's) joins its run.
import type {
  Binding,
  BindingValue,
  CellId,
  Execution,
  ExecutionId,
  KernelStatus,
  Route,
} from "@jsnb/core";

import type { SessionContext } from "./context.js";
import type { ExecutionRecord } from "./records.js";
import { toExecution } from "./records.js";
import type { CellRunAnswer, NotebookRun, NotebookRunAnswer, Waiting } from "./runs/control.js";
import { runCell, runNotebook } from "./runs/control.js";
import type { ClientRunner } from "./runs/execute.js";
import { clearOutputs } from "./runs/clear.js";
import { executeRun } from "./runs/execute.js";
import type { AutoRun } from "./runs/autoRun.js";
import { createAutoRun } from "./runs/autoRun.js";
import { addOutput, findExecution, finish } from "./runs/executions.js";
import {
  cellRunsDropper,
  clearClientRuns,
  clearQueue,
  interruptRuns,
  restartKernel,
} from "./runs/kernelControl.js";
import { routesOf, serverBindings, serverScope } from "./runs/kernelViews.js";
import type { ValueRequest } from "./runs/outputs.js";
import { fullValue, outputValue } from "./runs/outputs.js";
import type { RunQueue } from "./runs/queue.js";
import { createRunQueue } from "./runs/queue.js";
import { runError } from "./runs/errors.js";
import type { Slice } from "./runs/slice.js";
import type { LogTail } from "../../files/logs/kernelLog.js";
import { readLogTail } from "../../files/logs/kernelLog.js";

/** What the runs need from the session's client realm (the page). */
export type RealmPart = {
  readonly attached: () => boolean;
  /** Whether a run may count on a page: one is attached, or the headless realm can open one. */
  readonly available: () => boolean;
  /** A page holds the realm once it settles (the headless page opened when needed), else RealmNotAttached. */
  readonly ensure: () => Promise<void>;
  readonly run: ClientRunner;
  readonly bindings: (cell: CellId) => BindingValue[];
  readonly scope: () => Binding[];
  /** After a kernel restart: the page's bridge layer cleared (or, with `all`, the whole client realm reset). */
  readonly reset: (all: boolean) => Promise<void>;
  /** Whether the page runs the client run `execution` now. */
  readonly runs: (execution: ExecutionId) => boolean;
  /** kernel.interrupt while the page runs `execution`: the page ends it, or the daemon does within a second; false when
   * the page had finished it already. */
  readonly interrupt: (execution: ExecutionRecord) => Promise<boolean>;
};

export type SessionRuns = {
  readonly queue: RunQueue;
  /** Whether a page is attached to run client cells. */
  readonly realmAttached: () => boolean;
  /** A page holds the realm once it settles (realm.headless opens one), else RealmNotAttached. */
  readonly realmReady: () => Promise<void>;
  readonly run: (cell: CellId, waiting: Waiting) => Promise<Execution>;
  /** cell.run's answer: the run and, with execution.autoRunDependents, the dependents it started. */
  readonly runWithDependents: (cell: CellId, waiting: Waiting) => Promise<CellRunAnswer>;
  readonly runAll: (input: NotebookRun) => Promise<NotebookRunAnswer>;
  readonly outputs: (cell: CellId) => Execution | null;
  /** A read of a value waits for the retained values' measures under way, so it sees the budget applied. */
  readonly outputValue: (request: ValueRequest) => Promise<Slice>;
  /** The full value of one of this session's last runs; undefined when `execution` is none of them. */
  readonly fullValue: (
    execution: ExecutionId,
    index: number,
  ) => Promise<{ readonly json: unknown } | undefined>;
  readonly bindings: (cell: CellId) => Promise<BindingValue[]>;
  readonly scope: (realm: "server" | "client") => Promise<Binding[]>;
  readonly routes: () => Route[];
  readonly kernelStatus: () => KernelStatus;
  /** The tail of the kernel's log file (kernel.log). */
  readonly kernelLog: (lines: number) => LogTail;
  readonly interrupt: () => Promise<CellId | null>;
  /** cell.delete: ends the queued runs of `cell`, interrupts its run under way (in the kernel, or on the page for
   * a client run the realm says it runs) and ends one still being prepared before it executes; settles once done. */
  readonly dropRuns: (cell: CellId) => Promise<void>;
  readonly restart: (all: boolean) => Promise<void>;
  /** realm.restart: the queued client runs ended, then the page's full reset. */
  readonly restartRealm: () => Promise<void>;
  /** notebook.clearOutputs: the cells' last runs forgotten (all cells when absent); the cells cleared. */
  readonly clearOutputs: (cells?: readonly CellId[]) => CellId[];
  /** Closing: the queue cleared and the running run ended with the kernel. */
  readonly stop: () => Promise<void>;
};

/** The session's queue, whose runs each end through the cascade of execution.autoRunDependents. */
function queueOf(context: SessionContext, realm: RealmPart) {
  const cascade: { current?: AutoRun } = {};
  const queue = createRunQueue(
    async (run) => {
      try {
        await executeRun(context, run, realm.run);
      } finally {
        cascade.current?.ended(run);
      }
    },
    (run, error) => {
      context.log.error(
        { err: error, execution: run.execution.id },
        "a run failed inside the daemon",
      );
      finish(context, run.execution, {
        status: "error",
        durationMs: 0,
        error: runError(error, run.execution.cell),
      });
    },
    () => cascade.current?.idle(),
  );
  cascade.current = createAutoRun(context, queue, realm.available);
  return { queue, autoRun: cascade.current };
}

/** The session's queue and run commands over `realm`. */
export function createRuns(context: SessionContext, realm: RealmPart): SessionRuns {
  const { queue, autoRun: cascade } = queueOf(context, realm);
  context.hooks.edited = cascade.edited;
  context.hooks.realmEnded = cascade.realmEnded;
  context.hooks.deleting = cascade.deleting;
  context.hooks.runEnded = async (cell) => {
    const running = queue.running();
    await (running?.execution.cell === cell ? running.done : undefined);
  };
  context.hooks.autoRunState = cascade.state;
  context.hooks.lateOutput = (late) => {
    const execution = findExecution(context, late.execution);
    if (execution) addOutput(context, execution, late.output, late.full);
  };
  const runs = { queue, realmReady: realm.ensure, autoRun: cascade };
  return {
    outputs: (cell) => {
      const last = context.cells.require(cell).last;
      return last ? toExecution(last) : null;
    },
    outputValue: async (request) => {
      await context.runs.retained.settled();
      return outputValue(context, request);
    },
    fullValue: async (execution, index) => {
      await context.runs.retained.settled();
      return fullValue(context, execution, index);
    },
    bindings: (cell) =>
      context.cells.require(cell).type === "client"
        ? Promise.resolve(realm.bindings(cell))
        : serverBindings(context, cell),
    scope: (which) => (which === "client" ? Promise.resolve(realm.scope()) : serverScope(context)),
    routes: () => routesOf(context),
    kernelStatus: () => context.kernel.status(),
    kernelLog: (lines) => readLogTail(context.logPath, lines),
    queue,
    realmAttached: realm.attached,
    realmReady: realm.ensure,
    run: async (cell, waiting) =>
      (await runCell(context, runs, cell, { ...waiting, trigger: false })).execution,
    runWithDependents: (cell, waiting) => runCell(context, runs, cell, waiting),
    runAll: (input) => runNotebook(context, runs, input),
    interrupt: () => {
      cascade.stop();
      return interruptRuns(context, queue, realm);
    },
    clearOutputs: (cells) => clearOutputs(context, cells),
    dropRuns: cellRunsDropper(context, queue, realm),
    // kernel.restart, with `all` the page's full reset first
    restart: async (all) => {
      cascade.stop();
      clearQueue(context, queue);
      if (all) await realm.reset(true); // the page drops its client run first, as runtime-web reports it
      await restartKernel(context, queue, realm.runs);
      if (!all) await realm.reset(false);
    },
    restartRealm: async () => {
      clearClientRuns(context, queue);
      await realm.reset(true);
    },
    stop: async () => {
      cascade.stop();
      clearQueue(context, queue);
      context.runs.ending = true;
      await context.kernel.stop();
      await queue.running()?.done;
    },
  };
}
