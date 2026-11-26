// The wrapped setTimeout, setInterval, setImmediate and queueMicrotask: the real timers and handles, a
// disposer that clears a timer when its cell re-runs, and the callback started in a promise job under the store of its
// registration, where an interrupt can terminate it and the child lives on, its throw or rejection reported on
// that cell, then the process hooks it may have replaced checked.
import type { CellId } from "@jsnb/core";

import { callUserCode, onRejection, startUserCode } from "./userCode.js";

type Store = { readonly cell: CellId };
type RealTimer<H> = (callback: () => void, ms?: number) => H;

export type TimerOptions<S extends Store, H, I = H> = {
  readonly currentStore: () => S | undefined;
  /** Runs `fn` with `store` as the current store (AsyncLocalStorage). */
  readonly runIn: (store: S | undefined, fn: () => void) => void;
  readonly addDisposer: (cell: CellId, fn: () => void) => () => void;
  /** A timer callback threw or its promise rejected. */
  readonly onError: (store: S | undefined, error: unknown) => void;
  /** A callback returned (the process hooks checked after every callback the kernel started). */
  readonly afterCall: (store: S | undefined) => void;
  /** The realm's own timers, which packages keep using. */
  readonly real: {
    readonly setTimeout: RealTimer<H>;
    readonly setInterval: RealTimer<H>;
    readonly clear: (handle: H) => void;
    readonly setImmediate: (callback: () => void) => I;
    readonly clearImmediate: (handle: I) => void;
    /** Only to refuse a call Node would refuse, with Node's own error. */
    readonly queueMicrotask: (callback: () => void) => void;
  };
};

type WrappedTimer = (callback: unknown, ms?: unknown, ...args: unknown[]) => unknown;
type WrappedImmediate = (callback: unknown, ...args: unknown[]) => unknown;
type WrappedMicrotask = (callback: unknown) => void;

const isCallback = (value: unknown): value is (...args: unknown[]) => unknown =>
  typeof value === "function";

function invoke<S extends Store, H, I>(
  options: TimerOptions<S, H, I>,
  store: S | undefined,
  callback: (...args: unknown[]) => unknown,
  args: readonly unknown[],
): void {
  options.runIn(store, () => {
    try {
      const result = callUserCode(callback, undefined, args);
      // A rejection is reported here, so it never reaches unhandledRejection.
      onRejection(result, (error) => {
        options.onError(store, error);
      });
    } catch (error) {
      options.onError(store, error);
    }
  });
  options.afterCall(store);
}

function wrap<S extends Store, H, I>(
  options: TimerOptions<S, H, I>,
  repeats: boolean,
): WrappedTimer {
  const real = repeats ? options.real.setInterval : options.real.setTimeout;
  return (callback, ms, ...args) => {
    // A call Node would refuse goes to Node unchanged, so the cell sees Node's own error.
    if (!isCallback(callback)) {
      const refused: unknown = Reflect.apply(real, undefined, [callback, ms, ...args]);
      return refused;
    }
    const store = options.currentStore();
    let remove: (() => void) | undefined;
    const handle = real(
      () => {
        if (!repeats) remove?.();
        startUserCode(() => {
          invoke(options, store, callback, args);
        });
      },
      typeof ms === "number" ? ms : Number(ms ?? 0),
    );
    if (store) {
      remove = options.addDisposer(store.cell, () => {
        options.real.clear(handle);
      });
    }
    return handle;
  };
}

function wrapImmediate<S extends Store, H, I>(options: TimerOptions<S, H, I>): WrappedImmediate {
  const { setImmediate: real, clearImmediate: clear } = options.real;
  return (callback, ...args) => {
    // A call Node would refuse goes to Node unchanged, so the cell sees Node's own error.
    if (!isCallback(callback)) {
      const refused: unknown = Reflect.apply(real, undefined, [callback, ...args]);
      return refused;
    }
    const store = options.currentStore();
    let remove: (() => void) | undefined;
    const handle = real(() => {
      remove?.();
      startUserCode(() => {
        invoke(options, store, callback, args);
      });
    });
    if (store) {
      remove = options.addDisposer(store.cell, () => {
        clear(handle);
      });
    }
    return handle;
  };
}

/** A cell's queueMicrotask: the callback in a promise job under the caller's store. */
function wrapMicrotask<S extends Store, H, I>(options: TimerOptions<S, H, I>): WrappedMicrotask {
  return (callback) => {
    // A call Node would refuse goes to Node unchanged, so the cell sees Node's own error.
    if (!isCallback(callback)) {
      Reflect.apply(options.real.queueMicrotask, undefined, [callback]);
      return;
    }
    const store = options.currentStore();
    startUserCode(() => {
      invoke(options, store, callback, []);
    });
  };
}

type Timers = {
  readonly setTimeout: WrappedTimer;
  readonly setInterval: WrappedTimer;
  readonly setImmediate: WrappedImmediate;
  readonly queueMicrotask: WrappedMicrotask;
};

/** `setTimeout`, `setInterval`, `setImmediate` and `queueMicrotask` for the built-ins layer. */
export function createTimers<S extends Store, H, I>(options: TimerOptions<S, H, I>): Timers {
  return {
    setTimeout: wrap(options, false),
    setInterval: wrap(options, true),
    setImmediate: wrapImmediate(options),
    queueMicrotask: wrapMicrotask(options),
  };
}
