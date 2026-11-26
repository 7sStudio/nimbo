// The time a realm (the kernel, the headless page) spends paused in the debugger, which no wait of the daemon on it
// counts: a request, a bridge call, a route or a caller's run wait whose time runs out while it is paused waits on until
// it resumes, then for the rest of its time.
import { timerMs } from "./timers.js";

export type PauseClock = {
  readonly paused: () => boolean;
  /** Milliseconds paused so far, the pause under way excluded. */
  readonly heldMs: () => number;
  /** Hears each time the realm pauses; returns the stop. */
  readonly onPause: (listener: () => void) => () => void;
  /** Hears each time the realm pauses or resumes; returns the stop. */
  readonly onChange: (listener: () => void) => () => void;
};

/** A clock fed by a realm's paused and resumed reports. */
export function createPauseClock(): PauseClock & { readonly set: (paused: boolean) => void } {
  let since: number | undefined;
  let held = 0;
  const pauses = new Set<() => void>();
  const changes = new Set<() => void>();
  const listen = (set: Set<() => void>, listener: () => void) => {
    set.add(listener);
    return () => set.delete(listener);
  };
  return {
    paused: () => since !== undefined,
    heldMs: () => held,
    onPause: (listener) => listen(pauses, listener),
    onChange: (listener) => listen(changes, listener),
    set: (paused) => {
      if (paused && since === undefined) {
        since = performance.now();
        for (const listener of [...pauses]) listener();
        for (const listener of [...changes]) listener();
      }
      if (!paused && since !== undefined) {
        held += performance.now() - since;
        since = undefined;
        for (const listener of [...changes]) listener();
      }
    },
  };
}

/** A clock paused while either clock is; `stop` ends its listening. */
export function eitherPaused(
  a: PauseClock,
  b: PauseClock,
): PauseClock & { readonly stop: () => void } {
  const clock = createPauseClock();
  const follow = (): void => {
    clock.set(a.paused() || b.paused());
  };
  const stops = [a.onChange(follow), b.onChange(follow)];
  follow();
  return {
    ...clock,
    stop: () => {
      for (const stop of stops) stop();
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
