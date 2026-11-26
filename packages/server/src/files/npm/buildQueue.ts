// The builds behind /npm/: at most `concurrency` run at once and the rest wait their turn in order;
// the requests for one key (a package's split bundle, one standalone entry, a workspace module) share one build,
// waiting or running; a build's time limit runs from its start, not from the request's; a build that no request waits
// for any more leaves the queue, or is cancelled while it runs (esbuild's cancel, then its context disposed).
import { availableParallelism } from "node:os";

/** A build that ran past its limit; its message is the reason the page is told. */
export class BuildTimedOut extends Error {
  constructor(timeoutMs: number) {
    super(`its build ran past the limit of ${String(timeoutMs / 1000)} s and was stopped`);
    this.name = "BuildTimedOut";
  }
}

type Job<T> = {
  readonly result: Promise<T>;
  readonly cancel: AbortController;
  waiting: number;
};

/** The builds' turns: at most `concurrency` at once, each stopped `timeoutMs` after it started. */
export type Turns = {
  /** `work` once its turn came, under a signal that `cancel` or the limit aborts; never started once `cancel` aborted. */
  readonly take: <T>(work: (signal: AbortSignal) => Promise<T>, cancel: AbortSignal) => Promise<T>;
  /** How many builds run and wait now. */
  readonly load: () => { readonly running: number; readonly queued: number };
};

/** The builds of one kind, by key: `work` joined when one with its key waits or runs; rejects once `signal` aborts. */
export type BuildQueue<T> = (
  key: string,
  work: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
) => Promise<T>;

/** esbuild spreads one build over its own threads: a few at once keep the page's first imports going without starving. */
export const defaultConcurrency = (): number =>
  Math.min(4, Math.max(2, Math.floor(availableParallelism() / 2)));

/** Why `signal` aborted, as an Error. */
export const reasonOf = (signal: AbortSignal): Error =>
  signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason));

/** Rejects once `signal` aborts, with its reason. */
const abortedBy = (signal: AbortSignal): Promise<never> =>
  new Promise((_, reject: (reason: Error) => void) => {
    if (signal.aborted) reject(reasonOf(signal));
    signal.addEventListener(
      "abort",
      () => {
        reject(reasonOf(signal));
      },
      { once: true },
    );
  });

/** The request's wait for `job`: the last one to leave cancels it. */
async function waitFor<T>(job: Job<T>, signal: AbortSignal): Promise<T> {
  job.waiting += 1;
  let left = false;
  const leave = (): void => {
    if (left) return;
    left = true;
    job.waiting -= 1;
    if (job.waiting === 0) job.cancel.abort(new Error("every request for the build went away"));
  };
  signal.addEventListener("abort", leave, { once: true });
  const gone = abortedBy(signal);
  gone.catch(() => undefined); // read below; never an unhandled rejection
  try {
    return await Promise.race([job.result, gone]);
  } finally {
    signal.removeEventListener("abort", leave);
    if (signal.aborted) leave();
  }
}

/** The turns of builds, `concurrency` at once, each stopped `timeoutMs` after it started. */
export function createTurns(options: {
  readonly concurrency: number;
  readonly timeoutMs: number;
}): Turns {
  const waiting: (() => void)[] = [];
  let running = 0;
  const next = (): void => {
    while (running < options.concurrency && waiting.length > 0) waiting.shift()?.();
  };
  const turn = (cancel: AbortSignal): Promise<void> =>
    new Promise((resolve, reject: (reason: Error) => void) => {
      const start = (): void => {
        cancel.removeEventListener("abort", drop);
        running += 1;
        resolve();
      };
      const drop = (): void => {
        waiting.splice(waiting.indexOf(start), 1);
        reject(reasonOf(cancel));
      };
      cancel.addEventListener("abort", drop, { once: true });
      waiting.push(start);
      next();
    });
  const take = async <T>(work: (signal: AbortSignal) => Promise<T>, cancel: AbortSignal) => {
    await turn(cancel);
    const limit = new AbortController();
    const timer = setTimeout(() => {
      limit.abort(new BuildTimedOut(options.timeoutMs));
    }, options.timeoutMs);
    try {
      return await work(AbortSignal.any([cancel, limit.signal]));
    } finally {
      clearTimeout(timer);
      running -= 1;
      next();
    }
  };
  return { take, load: () => ({ running, queued: waiting.length }) };
}

/** The builds of one kind, each taking its turn from `turns`. */
export function createBuildQueue<T>(turns: Turns): BuildQueue<T> {
  const jobs = new Map<string, Job<T>>();
  return (key, work, signal) => {
    signal.throwIfAborted();
    const existing = jobs.get(key);
    if (existing !== undefined && !existing.cancel.signal.aborted) return waitFor(existing, signal);
    const cancel = new AbortController();
    const job: Job<T> = { result: turns.take(work, cancel.signal), cancel, waiting: 0 };
    jobs.set(key, job);
    const done = (): void => {
      if (jobs.get(key) === job) jobs.delete(key);
    };
    job.result.then(done, done); // each waiting request gets the failure; the next one builds again
    return waitFor(job, signal);
  };
}
