// One load shared by every caller waiting for it: progress reaches each, a caller that aborts only lets itself go,
// and the load itself stops (its worker terminated) when the last waiting caller leaves.
import type { LoadProgress } from "./engine.ts";
import { QueryError, loadError, messages } from "./errors.ts";

type Waiter<T> = {
  readonly onProgress: ((progress: LoadProgress) => void) | undefined;
  readonly resolve: (value: T) => void;
  readonly reject: (error: QueryError) => void;
  readonly release: () => void;
};

type Run<T> = { readonly controller: AbortController; readonly waiters: Set<Waiter<T>> };

export type Start<T> = (
  onProgress: (progress: LoadProgress) => void,
  signal: AbortSignal,
) => Promise<T>;

export type SharedLoad<T> = {
  /** Waits for the current load, starting one when none runs. */
  acquire(onProgress?: (progress: LoadProgress) => void, signal?: AbortSignal): Promise<T>;
  /** Aborts the current load and rejects everyone waiting for it with `error`. */
  stop(error: QueryError): void;
  /** True while a load runs. */
  running(): boolean;
};

const cancelled = () => new QueryError("cancelled", messages.cancelled());

/** Hands every waiter its outcome and empties the run. */
function finish<T>(run: Run<T>, settle: (waiter: Waiter<T>) => void) {
  for (const waiter of run.waiters) {
    waiter.release();
    settle(waiter);
  }
  run.waiters.clear();
}

/** Starts one run of `start`; its outcome goes to the waiters present when it settles. */
function begin<T>(
  start: Start<T>,
  discard: (value: T) => void,
  onSettled: (run: Run<T>) => void,
): Run<T> {
  const run: Run<T> = { controller: new AbortController(), waiters: new Set() };
  const progress = (value: LoadProgress) => {
    for (const waiter of run.waiters) waiter.onProgress?.(value);
  };
  const settled = (value: T) => {
    onSettled(run);
    if (run.controller.signal.aborted) {
      discard(value);
      return;
    }
    finish(run, (waiter) => {
      waiter.resolve(value);
    });
  };
  const failed = (error: unknown) => {
    onSettled(run);
    const reason = error instanceof QueryError ? error : loadError(error);
    finish(run, (waiter) => {
      waiter.reject(reason);
    });
  };
  // Both outcomes are handled here; the waiters receive them through their own promises.
  void start(progress, run.controller.signal).then(settled, failed);
  return run;
}

/** Adds a waiter to `run`; its abort lets only it go, and aborts the run when it was the last one. */
function join<T>(
  run: Run<T>,
  onProgress: Waiter<T>["onProgress"],
  signal: AbortSignal | undefined,
) {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      waiter.release();
      run.waiters.delete(waiter);
      reject(cancelled());
      if (run.waiters.size === 0) run.controller.abort();
    };
    const waiter: Waiter<T> = {
      onProgress,
      resolve,
      reject,
      release: () => {
        signal?.removeEventListener("abort", onAbort);
      },
    };
    run.waiters.add(waiter);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Shares `start` between concurrent callers; `discard` receives a value whose load was aborted meanwhile. */
export function sharedLoad<T>(start: Start<T>, discard: (value: T) => void): SharedLoad<T> {
  let current: Run<T> | undefined;
  const forget = (run: Run<T>) => {
    if (current === run) current = undefined;
  };
  return {
    acquire: (onProgress, signal) => {
      if (signal?.aborted === true) return Promise.reject(cancelled());
      if (current?.controller.signal.aborted === true) forget(current);
      current ??= begin(start, discard, forget);
      return join(current, onProgress, signal);
    },
    stop: (error) => {
      if (current === undefined) return;
      const run = current;
      forget(run);
      run.controller.abort();
      finish(run, (waiter) => {
        waiter.reject(error);
      });
    },
    running: () => current !== undefined && !current.controller.signal.aborted,
  };
}
