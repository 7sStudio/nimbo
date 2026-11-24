// The full values the daemon retains (03-api §4.10, §7.5): each cell's last run's `value` outputs in full (the
// kernel's `full` form of a cut value, else the output's own json), up to `outputs.retainMaxBytes` per notebook, the
// oldest dropped first; in daemon memory, so they survive a kernel restart. A value is sized by its JSON text in slices
// of at most 8 ms (jsonSize.ts): a small one at once, a large one over later turns of the event
// loop, kept meanwhile and let go if it turns out larger than the budget (one dropped or replaced meanwhile is no longer
// walked); a value refused for its size is remembered, so its message says so rather than "no longer retained". A read
// waits for the measures under way (`settled`), so it sees the budget applied to every value kept before it.
import type { ExecutionId } from "@jsnb/core";

import { jsonSizer } from "./jsonSize.js";

type RetainedValue = {
  readonly execution: ExecutionId;
  readonly index: number;
  readonly json: unknown;
  /** The JSON text's UTF-8 length, what the budget counts; undefined while it is being measured. */
  bytes: number | undefined;
};

/**
 * Why a value is not retained: larger than `budget` (cut by its kernel at the budget it started with, or sized here),
 * or no full form came.
 */
type Refusal =
  | { readonly why: "tooLarge"; readonly budget: number; readonly byKernel: boolean }
  | { readonly why: "noFullForm" };

export type Retained = {
  /** Keeps `json` as the full value of output `index` of `execution`, dropping the oldest beyond the budget. */
  readonly keep: (execution: ExecutionId, index: number, json: unknown) => void;
  readonly get: (execution: ExecutionId, index: number) => RetainedValue | undefined;
  /**
   * Records that output `index` of `execution` is not retained, and why, dropping what was kept under it: a value its
   * kernel cut at the budget, or a cut value with no full form. Nothing else is evicted for it.
   */
  readonly refuse: (execution: ExecutionId, index: number, why: Refusal) => void;
  /** Why output `index` of `execution` was refused, if it was: larger than the budget, or no full form. */
  readonly refusal: (execution: ExecutionId, index: number) => Refusal | undefined;
  /** Forgets every value of `execution` (its cell ran again, or was deleted). */
  readonly drop: (execution: ExecutionId) => void;
  /** Forgets every value (the notebook closed). */
  readonly clear: () => void;
  /** Settles once every value kept so far is sized and counted, or let go: what a read waits for. */
  readonly settled: () => Promise<void>;
  /** Hears each value that goes, so what was built from it (a SQL table) goes too. */
  readonly onDrop: (listener: (value: RetainedValue) => void) => void;
};

const keyOf = (execution: ExecutionId, index: number): string => `${execution}:${String(index)}`;

/** The longest one slice of sizing holds the event loop, unless the store is given another. */
const defaultSliceMs = 8;

export type RetainedOptions = {
  /** The length of a slice of sizing; 0 ends a slice at each check of the clock, every 256 nodes. */
  readonly sliceMs?: number;
  /** Runs the next slice: setImmediate, so the event loop's other work runs between two slices. */
  readonly defer?: (slice: () => void) => void;
};

/** A measure that spans slices, and what ends the wait for it. */
type Measure = { readonly done: Promise<void>; readonly end: () => void };

type Store = {
  readonly values: Map<string, RetainedValue>;
  /** The values whose measure spans slices and is not over. */
  readonly measuring: Map<RetainedValue, Measure>;
  readonly refused: Map<string, Refusal>;
  readonly listeners: ((value: RetainedValue) => void)[];
  readonly maxBytes: () => number;
  readonly sliceMs: number;
  readonly defer: (slice: () => void) => void;
  total: number;
};

function measureOf(): Measure {
  let end = (): void => undefined;
  const done = new Promise<void>((resolve) => {
    end = resolve;
  });
  return { done, end };
}

/** The measure of `value` is over (sized, refused, or the value let go): what waits for it goes on. */
function ended(store: Store, value: RetainedValue): void {
  store.measuring.get(value)?.end();
  store.measuring.delete(value);
}

function remove(store: Store, key: string): void {
  const value = store.values.get(key);
  if (!value) return;
  store.values.delete(key);
  ended(store, value);
  store.total -= value.bytes ?? 0;
  for (const listener of store.listeners) listener(value);
}

/** The size of `value` is known: counted, or refused when larger than the budget; the oldest go beyond it. */
function sized(store: Store, key: string, value: RetainedValue, bytes: number): void {
  ended(store, value);
  const budget = store.maxBytes();
  if (bytes > budget) {
    remove(store, key);
    store.refused.set(key, { why: "tooLarge", budget, byKernel: false });
    return;
  }
  for (const [other, kept] of store.values) {
    if (store.total + bytes <= budget) break;
    if (other !== key && kept.bytes !== undefined) remove(store, other);
  }
  value.bytes = bytes;
  store.total += bytes;
}

/** Measures `value` in slices: the first now, the rest after the event loop's other work; never rejects. */
function measure(store: Store, key: string, value: RetainedValue): void {
  const sizer = jsonSizer(value.json);
  const slice = (): void => {
    if (store.values.get(key) !== value) return; // dropped or replaced meanwhile: the walk and the value go
    let done: boolean;
    try {
      done = sizer.step(performance.now() + store.sliceMs);
    } catch {
      // A value JSON cannot write (it never is: the kernel encoded it) is never retained, as no download could write it.
      sized(store, key, value, Number.POSITIVE_INFINITY);
      return;
    }
    if (done) {
      sized(store, key, value, sizer.bytes());
      return;
    }
    if (!store.measuring.has(value)) store.measuring.set(value, measureOf());
    store.defer(slice);
  };
  slice();
}

function storeOf(maxBytes: () => number, options: RetainedOptions): Store {
  const { sliceMs = defaultSliceMs, defer = setImmediate } = options;
  const values = new Map<string, RetainedValue>();
  const measuring = new Map<RetainedValue, Measure>();
  return {
    values,
    measuring,
    refused: new Map(),
    listeners: [],
    maxBytes,
    sliceMs,
    defer,
    total: 0,
  };
}

/** A store bounded by `maxBytes()` (read once each value is sized, so a settings change applies to the next one). */
export function createRetained(maxBytes: () => number, options: RetainedOptions = {}): Retained {
  const store = storeOf(maxBytes, options);
  const forget = (key: string): void => {
    store.refused.delete(key);
    remove(store, key);
  };
  return {
    keep: (execution, index, json) => {
      const key = keyOf(execution, index);
      forget(key);
      const value: RetainedValue = { execution, index, json, bytes: undefined };
      store.values.set(key, value);
      measure(store, key, value);
    },
    get: (execution, index) => store.values.get(keyOf(execution, index)),
    refuse: (execution, index, why) => {
      const key = keyOf(execution, index);
      forget(key);
      store.refused.set(key, why);
    },
    refusal: (execution, index) => store.refused.get(keyOf(execution, index)),
    drop: (execution) => {
      for (const key of [...store.values.keys(), ...store.refused.keys()]) {
        if (key.startsWith(`${execution}:`)) forget(key);
      }
    },
    clear: () => {
      store.refused.clear();
      for (const key of [...store.values.keys()]) remove(store, key);
    },
    settled: async () => {
      await Promise.all([...store.measuring.values()].map((measure) => measure.done));
    },
    onDrop: (listener) => {
      store.listeners.push(listener);
    },
  };
}
