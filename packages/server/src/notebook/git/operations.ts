// One git operation at a time per repository. Short writes (stage, commit, switch) wait for each other in order; a
// long one (fetch, pull, push, publish, sync) starts only when nothing runs, and while it runs every other write is
// answered at once with reason busy, so a click never queues behind a slow network. git.cancel aborts the long one.
import { refusal } from "./tree.js";

type Running = { readonly name: string; readonly controller: AbortController };

export type Operations = {
  /** Runs a short write after the ones before it; busy while a long one runs. */
  readonly short: <T>(name: string, work: () => Promise<T>) => Promise<T>;
  /** Runs a long operation with its abort signal; busy while anything runs. */
  readonly long: <T>(name: string, work: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  /** Aborts the long operation under way: its name, or null when none runs. */
  readonly cancel: () => string | null;
};

const busy = (name: string, running: string): Error =>
  refusal(name, "busy", `git ${running} is running; try again when it ends, or cancel it`);

export function createOperations(): Operations {
  let long: Running | undefined;
  let pending = 0;
  let chain: Promise<unknown> = Promise.resolve();
  return {
    short: async (name, work) => {
      if (long !== undefined) throw busy(name, long.name);
      pending += 1;
      const run = chain.then(work);
      chain = run.catch(() => undefined);
      try {
        return await run;
      } finally {
        pending -= 1;
      }
    },
    long: async (name, work) => {
      if (long !== undefined) throw busy(name, long.name);
      if (pending > 0) throw busy(name, "another command");
      const current = { name, controller: new AbortController() };
      long = current;
      try {
        return await work(current.controller.signal);
      } finally {
        long = undefined;
      }
    },
    cancel: () => {
      if (long === undefined) return null;
      long.controller.abort();
      return long.name;
    },
  };
}
