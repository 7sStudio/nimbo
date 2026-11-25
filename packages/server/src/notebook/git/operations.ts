// One git write at a time per repository: while one runs (a commit whose hook is slow, a pull), every other write is
// answered at once with reason busy naming it, so nothing waits unseen behind it; git.cancel stops whichever runs.
import { refusal } from "./tree.js";

type Running = { readonly name: string; readonly controller: AbortController };

export type Operations = {
  /** Runs a write with its abort signal; busy while another runs. */
  readonly run: <T>(name: string, work: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  /** Aborts the write under way: its name, or null when none runs. */
  readonly cancel: () => string | null;
  /** The write under way, or null. */
  readonly running: () => string | null;
};

const busy = (name: string, running: string): Error =>
  refusal(
    name,
    "busy",
    `git ${running} is running (a hook or the network may be slow); try again when it ends, or cancel it`,
  );

/** `onChange` hears the write under way change: its name when it starts, null when it ends. */
export function createOperations(onChange: (running: string | null) => void): Operations {
  let current: Running | undefined;
  return {
    run: async (name, work) => {
      if (current !== undefined) throw busy(name, current.name);
      const mine = { name, controller: new AbortController() };
      current = mine;
      onChange(name);
      try {
        return await work(mine.controller.signal);
      } finally {
        current = undefined;
        onChange(null);
      }
    },
    cancel: () => {
      if (current === undefined) return null;
      current.controller.abort();
      return current.name;
    },
    running: () => current?.name ?? null,
  };
}
