// The time a kernel spends paused in the debugger, which no wait of the daemon counts: a request, a bridge call, a
// route or a caller's run wait whose time runs out while the kernel is paused waits on until it resumes, then for the
// rest of its time.
import { timerMs } from "./timers.js";

export type PauseClock = {
  readonly paused: () => boolean;
  /** Milliseconds paused so far, the pause under way excluded. */
  readonly heldMs: () => number;
  /** Hears each time the kernel pauses; returns the stop. */
  readonly onPause: (listener: () => void) => () => void;
};

/** A clock fed by the kernel's paused and resumed reports. */
export function createPauseClock(): PauseClock & { readonly set: (paused: boolean) => void } {
  let since: number | undefined;
  let held = 0;
  const listeners = new Set<() => void>();
  return {
    paused: () => since !== undefined,
    heldMs: () => held,
    onPause: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (paused) => {
      if (paused && since === undefined) {
        since = performance.now();
        for (const listener of [...listeners]) listener();
      }
      if (!paused && since !== undefined) {
        held += performance.now() - since;
        since = undefined;
      }
    },
  };
}

/** How often a wait whose time ran out while paused looks again. */
const pollMs = 250;

/** A timer of `ms` that does not count the time `clock` is paused; `fire` runs once it ran out. */
export function pausableTimer(
  ms: number,
  clock: PauseClock | undefined,
  fire: () => void,
): { readonly stop: () => void } {
  let deadline = performance.now() + ms;
  let held = clock?.heldMs() ?? 0;
  let timer: NodeJS.Timeout | undefined;
  const arm = (wait: number): void => {
    timer = setTimeout(check, timerMs(Math.max(0, wait)));
  };
  function check(): void {
    if (clock?.paused() === true) {
      arm(pollMs);
      return;
    }
    const extra = (clock?.heldMs() ?? 0) - held;
    held += extra;
    deadline += extra;
    const left = deadline - performance.now();
    if (left > 0) arm(left);
    else fire();
  }
  arm(ms);
  return {
    stop: () => {
      clearTimeout(timer);
    },
  };
}
