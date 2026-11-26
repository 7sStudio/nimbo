// The run queue: one per notebook, first in first out, one run at a time (server, client and
// markdown cells alike: the notebook runs in order); a queued run can be taken off before it starts.
import type { CellId } from "@jsnb/core";

import type { ExecutionRecord } from "../records.js";

/** The runs one notebook.run queued together, so stopOnError can stop the rest; `stoppedBy`, the cell whose run
 * failed, which each run it ends unstarted names. */
export type Batch = { stopped: boolean; stoppedBy?: CellId };

export type QueuedRun = {
  readonly execution: ExecutionRecord;
  /** Settles once the run reached a terminal status. */
  readonly done: Promise<void>;
  readonly settle: () => void;
  readonly batch?: Batch;
  /** A cell.run's run: ending well, it may start execution.autoRunDependents. */
  readonly trigger?: true;
};

export type RunQueue = {
  readonly push: (run: QueuedRun) => void;
  /** The run that executes now. */
  readonly running: () => QueuedRun | undefined;
  /** Takes the queued runs `accept` names (every one when absent) off the queue, unstarted. */
  readonly take: (accept?: (run: QueuedRun) => boolean) => readonly QueuedRun[];
};

/** A run of `execution` not queued yet, with its terminal promise. */
export function queuedRun(execution: ExecutionRecord, batch?: Batch, trigger?: boolean): QueuedRun {
  let settle = (): void => undefined;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return {
    execution,
    done,
    settle,
    ...(batch === undefined ? {} : { batch }),
    ...(trigger === true ? { trigger: true as const } : {}),
  };
}

/** A queue that runs each run with `execute`; what `execute` throws is a daemon bug, reported to `failed`. `idle` hears
 * each time a run ended with none waiting: what it pushes then runs after everything anyone asked for. */
export function createRunQueue(
  execute: (run: QueuedRun) => Promise<void>,
  failed: (run: QueuedRun, error: unknown) => void,
  idle: () => void = () => undefined,
): RunQueue {
  const waiting: QueuedRun[] = [];
  let current: QueuedRun | undefined;
  const next = (ended: boolean): void => {
    if (current) return;
    current = waiting.shift();
    const run = current;
    if (!run) {
      if (ended) idle();
      return;
    }
    execute(run)
      .catch((error: unknown) => {
        failed(run, error);
      })
      .finally(() => {
        run.settle();
        current = undefined;
        next(true);
      });
  };
  return {
    push: (run) => {
      waiting.push(run);
      next(false);
    },
    running: () => current,
    take: (accept = () => true) => {
      const taken = waiting.filter(accept);
      for (const run of taken) waiting.splice(waiting.indexOf(run), 1);
      return taken;
    },
  };
}
