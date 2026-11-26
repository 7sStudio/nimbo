// The kernel reports a run's exports in a message of their own right after the run's status,
// so the daemon ends a server run only once that message is in: the next run (a client
// cell in the same notebook.run) and a bridge.call made on the run's `ok` see the bridge surface it left. A clock counts
// the exports messages (and the kernel's end, after which none comes); a run waits for one past the count it saw when
// it sent its execute.
import type { Log } from "../../../events/log.js";

export type ExportsClock = {
  /** Exports messages received, and kernel ends. */
  seen: number;
  readonly waiters: Set<() => void>;
};

/** Longest wait for an exports message: the kernel sends it with the status, so only a broken kernel exceeds it. */
const patienceMs = 2000;

export const createExportsClock = (): ExportsClock => ({ seen: 0, waiters: new Set() });

/** An exports message arrived, or the kernel ended: every waiter goes on. */
export function exportsArrived(clock: ExportsClock): void {
  clock.seen += 1;
  for (const wake of clock.waiters) wake();
  clock.waiters.clear();
}

/** Resolves once the clock passed `seen`, or after `patienceMs` (logged). */
export async function exportsAfter(clock: ExportsClock, log: Log, seen: number): Promise<void> {
  if (clock.seen > seen) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arrived = new Promise<boolean>((resolve) => {
    clock.waiters.add(() => {
      resolve(true);
    });
    timer = setTimeout(() => {
      resolve(false);
    }, patienceMs);
  });
  try {
    if (!(await arrived)) log.warn({}, "the kernel sent no exports after a run's status");
  } finally {
    clearTimeout(timer);
  }
}
