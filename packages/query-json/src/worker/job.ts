// One task's life on the main side: the promise its caller awaits, settled once with a reply or an error.
import type { QueryError, Result } from "../errors.ts";
import type { TaskSource } from "./protocol.ts";
import { readReply } from "./protocol.ts";

/**
 * How long one task may run once it reaches the worker, and a signal that cancels it queued or running. A task
 * `onlyIfRunning` is for the worker running when its turn comes (a release): with none running, it ends as done and
 * starts none.
 */
export type TaskOptions = {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal | undefined;
  readonly onlyIfRunning?: boolean;
};

/** How a task ended: the worker's reply, or an error decided on the main side. */
export type Outcome = { readonly reply: unknown } | { readonly error: QueryError };

export type Job = {
  /** The task, or how to build it for the worker that runs it. */
  readonly task: TaskSource;
  readonly options: TaskOptions;
  /** Settles the caller's promise; later calls are ignored. */
  readonly settle: (outcome: Outcome) => void;
};

/** A job and the promise of its typed result; `accept` checks the reply's value. */
export const createJob = <T>(
  task: TaskSource,
  accept: (value: unknown) => value is T,
  options: TaskOptions,
): { readonly job: Job; readonly result: Promise<Result<T>> } => {
  let resolve: (result: Result<T>) => void = () => undefined;
  const result = new Promise<Result<T>>((done) => {
    resolve = done;
  });
  let settled = false;
  const settle = (outcome: Outcome): void => {
    if (settled) return;
    settled = true;
    resolve(
      "error" in outcome ? { ok: false, error: outcome.error } : readReply(outcome.reply, accept),
    );
  };
  return { job: { task, options, settle }, result };
};

/** The error of a query cancelled through its AbortSignal. */
export const cancelled: QueryError = {
  kind: "aborted",
  message: "The query was cancelled. Run it again to see its result.",
};

/** The error of a query stopped after `timeoutMs`. */
export const timeoutError = (timeoutMs: number): QueryError => ({
  kind: "timeout",
  message: `The query ran longer than ${String(timeoutMs)} ms and was stopped. Narrow it, or raise query.timeoutMs.`,
});

export const timedOut = (timeoutMs: number): Outcome => ({ error: timeoutError(timeoutMs) });

/** The outcome of a task `onlyIfRunning` when no worker runs: nothing to do there. */
export const nothingRunning: Outcome = { reply: { ok: true, value: null } };

export const disposed: Outcome = {
  error: {
    kind: "aborted",
    message:
      "The query engine was disposed before the query finished. Load it again to run the query.",
  },
};

export const notStarted = (cause: unknown): Outcome => ({
  error: {
    kind: "unavailable",
    message: `The query worker could not start (${String(cause)}). Reload the page or restart the daemon.`,
  },
});

export const notSent = (cause: unknown): Outcome => ({
  error: {
    kind: "runtime",
    message: `The value cannot be sent to the query worker (${String(cause)}). Only JSON values can be queried.`,
  },
});
