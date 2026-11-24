// A run's disposers (04-kernel §7): run in reverse order before the cell's next run, on a full reset and on detach.
// Once they ran the list is closed: what a stale run adds later is disposed at once, and nothing new is started.

export type Disposers = {
  /** Registers a cleanup and returns its remover (a one-shot timer that fired drops its own); on a closed list the
   * cleanup runs at once. */
  readonly add: (dispose: () => unknown) => () => void;
  /** Runs and forgets every disposer, newest first, and closes the list; a throw or a rejection goes to `onError`. */
  readonly run: (onError: (error: unknown) => void) => void;
  /** True once the list ran: the run is stale and starts no timer or listener. */
  readonly closed: () => boolean;
  /** How many cleanups are held. */
  readonly size: () => number;
};

type Entry = { readonly dispose: () => unknown };

function call(dispose: () => unknown, onError: (error: unknown) => void): void {
  try {
    const result = dispose();
    if (result instanceof Promise) void result.catch(onError); // reported later; the reset does not wait
  } catch (error) {
    onError(error);
  }
}

export function createDisposers(): Disposers {
  const pending = new Set<Entry>();
  let closedWith: ((error: unknown) => void) | undefined;
  return {
    add: (dispose) => {
      if (closedWith !== undefined) {
        call(dispose, closedWith);
        return () => undefined;
      }
      const entry = { dispose };
      pending.add(entry);
      return () => {
        pending.delete(entry);
      };
    },
    run: (onError) => {
      closedWith = onError;
      const entries = [...pending].reverse();
      pending.clear();
      for (const entry of entries) call(entry.dispose, onError);
    },
    closed: () => closedWith !== undefined,
    size: () => pending.size,
  };
}
