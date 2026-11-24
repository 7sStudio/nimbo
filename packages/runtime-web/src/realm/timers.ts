// A run's timers (04-kernel §7): setTimeout, setInterval and requestAnimationFrame whose handles are disposed with it.
import type { Disposers } from "./disposers.js";
import type { Callable } from "./guard.js";
import { guard, isCallable } from "./guard.js";

export type Timers = {
  readonly setTimeout: (handler: unknown, timeout?: unknown, ...args: unknown[]) => unknown;
  readonly setInterval: (handler: unknown, timeout?: unknown, ...args: unknown[]) => unknown;
  readonly requestAnimationFrame: (callback: unknown) => unknown;
};

// The page's own functions, captured when the module loads; packages and the real clearTimeout keep using them.
const native = {
  setTimeout: window.setTimeout.bind(window),
  clearTimeout: window.clearTimeout.bind(window),
  setInterval: window.setInterval.bind(window),
  clearInterval: window.clearInterval.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
};

type Kind = {
  readonly start: (...args: never[]) => unknown;
  readonly stop: (handle: never) => void;
  /** A timeout or a frame fires once, so it drops its disposer when it does; an interval keeps it. */
  readonly oneShot: boolean;
};

/** The handle a stale run gets: nothing was scheduled (its disposers already ran), and clearing 0 does nothing. */
const notScheduled = 0;

/**
 * A function callback is guarded (04-kernel §5.3); a string handler (an eval) passes through as the page would take
 * it. The real handle is returned, so the real `clearTimeout` (reached through `window`) still works.
 */
function scheduler(kind: Kind, disposers: Disposers, onError: (error: unknown) => void) {
  return (handler: unknown, ...rest: unknown[]): unknown => {
    if (disposers.closed()) return notScheduled;
    let forget = (): void => undefined;
    const fire = (callback: Callable): Callable =>
      function (this: unknown, ...args: unknown[]): unknown {
        if (kind.oneShot) forget();
        return Reflect.apply(callback, this, args);
      };
    const scheduled = isCallable(handler) ? fire(guard(handler, onError)) : handler;
    const handle: unknown = Reflect.apply(kind.start, window, [scheduled, ...rest]);
    forget = disposers.add(() => Reflect.apply(kind.stop, window, [handle]));
    return handle;
  };
}

export function createTimers(disposers: Disposers, onError: (error: unknown) => void): Timers {
  const timeout = { start: native.setTimeout, stop: native.clearTimeout, oneShot: true };
  const interval = { start: native.setInterval, stop: native.clearInterval, oneShot: false };
  const frame = {
    start: native.requestAnimationFrame,
    stop: native.cancelAnimationFrame,
    oneShot: true,
  };
  return {
    setTimeout: scheduler(timeout, disposers, onError),
    setInterval: scheduler(interval, disposers, onError),
    requestAnimationFrame: scheduler(frame, disposers, onError),
  };
}
