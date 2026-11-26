// The store: AsyncLocalStorage of { cell, execution }, so whatever a run causes later (a
// timer, a route handler, a promise continuation, a late error) is attributed to its cell.
import { AsyncLocalStorage } from "node:async_hooks";

import type { CellId, ExecutionId } from "@jsnb/core";

export type Store = { readonly cell: CellId; readonly execution: ExecutionId };

export type Stores = {
  /** The store of the code running now, or undefined outside any cell's run. */
  readonly current: () => Store | undefined;
  /** Runs `fn` under `store`; with no store, outside any (the kernel's own work). */
  readonly run: <T>(store: Store | undefined, fn: () => T) => T;
  /** The store of the code `run` started last: the cell whose code ran last, undefined for code with no cell. */
  readonly last: () => Store | undefined;
};

/** A fresh AsyncLocalStorage of stores. */
export function createStores(): Stores {
  const storage = new AsyncLocalStorage<Store>();
  let last: Store | undefined;
  return {
    current: () => storage.getStore(),
    run: (store, fn) => {
      last = store;
      return store ? storage.run(store, fn) : storage.exit(fn);
    },
    last: () => last,
  };
}
