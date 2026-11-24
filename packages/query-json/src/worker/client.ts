// Main-thread side of the query worker: spawned on first use, one task in flight (the rest queue), and a timeout or
// an abort ends the task by terminating the worker; the next task starts a fresh one. Each worker started counts as a
// new generation, and a task given as a function of it is built right before it is posted, for that worker.
import type { Result } from "../errors.ts";
import { ok } from "../errors.ts";
import type { Job, Outcome, TaskOptions } from "./job.ts";
import {
  cancelled,
  createJob,
  disposed,
  nothingRunning,
  notSent,
  notStarted,
  timedOut,
} from "./job.ts";
import type { SpawnWorker, TaskSource, WorkerChannel, WorkerKind } from "./protocol.ts";
import { isFatalReply } from "./protocol.ts";
import { spawnWorker } from "./spawn.ts";

export type WorkerClient = {
  /** Runs a task; never rejects. `accept` checks the reply's value. */
  run<T>(
    task: TaskSource,
    accept: (value: unknown) => value is T,
    options: TaskOptions,
  ): Promise<Result<T>>;
  /** Ends every queued and running task as `aborted` and terminates the worker. */
  dispose(): Promise<void>;
  /** How many workers were started so far: the generation of the current one. */
  generation(): number;
};

type State = {
  readonly kind: WorkerKind;
  readonly spawnWorker: SpawnWorker;
  readonly memoryMb: number;
  readonly queue: Job[];
  /** How many workers were started: a task built for one generation suits that worker only. */
  generation: number;
  channel: WorkerChannel | undefined;
  running: { readonly job: Job; readonly timer: ReturnType<typeof setTimeout> } | undefined;
};

const finish = (state: State, outcome: Outcome): void => {
  if (state.running === undefined) return;
  clearTimeout(state.running.timer);
  state.running.job.settle(outcome);
  state.running = undefined;
};

const replace = (state: State): void => {
  const old = state.channel;
  state.channel = undefined;
  void old?.terminate(); // nothing waits on the old worker; the next task spawns a fresh one
};

const connect = (state: State): WorkerChannel => {
  state.generation += 1;
  const own: WorkerChannel = state.spawnWorker(state.kind, state.memoryMb, {
    onReply: (reply) => {
      if (state.channel !== own) return;
      finish(state, { reply });
      if (isFatalReply(reply)) replace(state);
      pump(state);
    },
    onFailure: (error) => {
      if (state.channel !== own) return;
      state.channel = undefined;
      finish(state, { error });
      pump(state);
    },
  });
  return own;
};

/** Hands a job to the worker, spawning it if needed (unless the job is only for a running one); false when it ended. */
const start = (state: State, job: Job): boolean => {
  if (job.options.onlyIfRunning === true && state.channel === undefined) {
    job.settle(nothingRunning);
    return false;
  }
  let channel: WorkerChannel;
  try {
    channel = state.channel ??= connect(state);
  } catch (cause) {
    job.settle(notStarted(cause));
    return false;
  }
  const task = typeof job.task === "function" ? job.task(state.generation) : ok(job.task);
  if (!task.ok) {
    job.settle({ error: task.error });
    return false;
  }
  try {
    channel.post(task.value);
    return true;
  } catch (cause) {
    job.settle(notSent(cause));
    return false;
  }
};

const pump = (state: State): void => {
  while (state.running === undefined) {
    const job = state.queue.shift();
    if (job === undefined) return;
    if (!start(state, job)) continue;
    const timeoutMs = job.options.timeoutMs;
    const timer = setTimeout(() => {
      finish(state, timedOut(timeoutMs));
      replace(state);
      pump(state);
    }, timeoutMs);
    state.running = { job, timer };
  }
};

const cancel = (state: State, job: Job): void => {
  if (state.running?.job === job) {
    finish(state, { error: cancelled });
    replace(state);
    pump(state);
    return;
  }
  const queued = state.queue.indexOf(job);
  if (queued >= 0) state.queue.splice(queued, 1);
  job.settle({ error: cancelled });
};

const run = <T>(
  state: State,
  task: TaskSource,
  accept: (value: unknown) => value is T,
  options: TaskOptions,
): Promise<Result<T>> => {
  const signal = options.signal;
  if (signal?.aborted) return Promise.resolve({ ok: false, error: cancelled });
  const { job, result } = createJob(task, accept, options);
  const onAbort = (): void => {
    cancel(state, job);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  state.queue.push(job);
  pump(state);
  return result.finally(() => {
    signal?.removeEventListener("abort", onAbort);
  });
};

const dispose = async (state: State): Promise<void> => {
  state.queue.splice(0).forEach((job) => {
    job.settle(disposed);
  });
  finish(state, disposed);
  const old = state.channel;
  state.channel = undefined;
  await old?.terminate();
};

/** A client for one engine's worker; `memoryMb` caps the worker's heap where the runtime allows it. */
export const createWorkerClient = (
  kind: WorkerKind,
  memoryMb: number,
  spawn: SpawnWorker = spawnWorker,
): WorkerClient => {
  const state: State = {
    kind,
    spawnWorker: spawn,
    memoryMb,
    queue: [],
    generation: 0,
    channel: undefined,
    running: undefined,
  };
  return {
    run: (task, accept, options) => run(state, task, accept, options),
    dispose: () => dispose(state),
    generation: () => state.generation,
  };
};
