// The per-cell disposer lists of 04-kernel §7 and the `dispose(fn)` built-in: before a cell re-runs, its disposers
// run in reverse order, async ones awaited, and their failures are collected for the new run to report. Each list is
// an insertion-ordered set, so taking one off (a timer that fired) costs the same however many a cell registered. A
// deleted cell is retired: its disposers run, and what its code still registers afterwards (a continuation that
// resumed after the deletion) is disposed at once, as a client run's late timers are; its next run revives it.
import type { CellId } from "@jsnb/core";

import { InvalidDisposer, typeName } from "@jsnb/core";

import { OutsideCell } from "./errors.js";
import { callUserCode } from "./userCode.js";

type Entry = { readonly fn: () => unknown };

export type Disposers = {
  /** Registers `fn` on `cell`; the returned function takes it off again. On a retired cell, `fn` runs at once. */
  readonly add: (cell: CellId, fn: () => unknown) => () => void;
  /** Runs and forgets `cell`'s disposers, last registered first; resolves with what they threw or rejected. */
  readonly run: (cell: CellId) => Promise<readonly unknown[]>;
  /** `run`, the cell retired first: the deleted cell's cleanups (04-kernel §7). */
  readonly retire: (cell: CellId) => Promise<readonly unknown[]>;
  /** A run of `cell` starts: what it registers stands again. */
  readonly revive: (cell: CellId) => void;
  readonly retired: (cell: CellId) => boolean;
};

/** Runs a retired cell's late cleanup now; what it throws or rejects goes to `failed`. */
async function runLate(fn: () => unknown, failed: (error: unknown) => void): Promise<void> {
  try {
    await fn();
  } catch (error) {
    // No run will collect it: the cell is gone, so it is reported as it happens.
    failed(error);
  }
}

/** Runs `list` last first, awaiting each, and answers what they threw or rejected. */
async function runAll(list: readonly Entry[]): Promise<readonly unknown[]> {
  const failures: unknown[] = [];
  for (const entry of [...list].reverse()) {
    // Called through a local, so the user's function is not named after the entry (`Object.fn`).
    const { fn } = entry;
    try {
      await fn();
    } catch (error) {
      // Collected, not swallowed: the new run reports each one as an error output (04-kernel §7).
      failures.push(error);
    }
  }
  return failures;
}

/** Empty disposer lists; `failed` hears a retired cell's late cleanup that threw (the kernel log). */
export function createDisposers(
  failed: (cell: CellId, error: unknown) => void = () => undefined,
): Disposers {
  const lists = new Map<CellId, Set<Entry>>();
  const retired = new Set<CellId>();
  const run = (cell: CellId) => {
    const list = [...(lists.get(cell) ?? [])];
    lists.delete(cell);
    return runAll(list);
  };
  return {
    add: (cell, fn) => {
      if (retired.has(cell)) {
        void runLate(fn, (error) => {
          failed(cell, error);
        });
        return () => undefined;
      }
      const entry: Entry = { fn };
      const list = lists.get(cell) ?? new Set<Entry>();
      list.add(entry);
      lists.set(cell, list);
      return () => {
        lists.get(cell)?.delete(entry);
      };
    },
    run,
    retire: (cell) => {
      retired.add(cell);
      return run(cell);
    },
    revive: (cell) => {
      retired.delete(cell);
    },
    retired: (cell) => retired.has(cell),
  };
}

const isCleanup = (value: unknown): value is () => unknown => typeof value === "function";

/** `dispose(fn)`: registers `fn` on the cell whose code calls it. */
export function createDispose(
  currentCell: () => CellId | undefined,
  disposers: Disposers,
): (fn: unknown) => void {
  return (fn) => {
    if (!isCleanup(fn)) throw new InvalidDisposer({ type: typeName(fn) });
    const cell = currentCell();
    if (cell === undefined) throw new OutsideCell({ builtin: "dispose" });
    // Called below the user-code frame, so an interrupt stops a disposer that hangs (04-kernel §6).
    disposers.add(cell, () => callUserCode(fn, undefined, []));
  };
}
