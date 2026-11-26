// The child's end of the IPC channel: daemon messages parsed with Zod, kernel messages sent with
// a callback counted, so shutdown can wait until the last one left the process. A send counts only once the raw send
// returned: an interrupt can stop user code inside one (display in a loop), whose callback then never comes, and an
// uncounted send cannot hold shutdown back.
import type { KernelMessage } from "./messages.js";
import { DaemonMessage } from "./messages.js";

/** `process.send` as the kernel calls it. */
type RawSend = (message: unknown, callback: (error: Error | null) => void) => unknown;

type Parsed =
  | { readonly ok: true; readonly message: DaemonMessage }
  | { readonly ok: false; readonly issues: string };

/** A daemon message, validated (Zod at every boundary). */
export function parseDaemonMessage(raw: unknown): Parsed {
  const parsed = DaemonMessage.safeParse(raw);
  return parsed.success
    ? { ok: true, message: parsed.data }
    : { ok: false, issues: parsed.error.message };
}

export type Channel = {
  readonly send: (message: KernelMessage) => void;
  /** Calls `fn` once every message sent so far has been handed over (or failed). */
  readonly afterLastSend: (fn: () => void) => void;
};

/** A channel over `send`; `onError` hears a send the daemon end refused (a closed channel). */
export function createChannel(send: RawSend, onError: (error: Error) => void): Channel {
  let pending = 0;
  let waiters: (() => void)[] = [];
  const settled = (): void => {
    if (pending > 0) return;
    const ready = waiters;
    waiters = [];
    for (const waiter of ready) waiter();
  };
  return {
    send: (message) => {
      const call = { answered: false, counted: false };
      send(message, (error) => {
        call.answered = true;
        if (call.counted) pending -= 1;
        if (error) onError(error);
        settled();
      });
      // No call between the check and the count, so nothing stops in between.
      if (!call.answered) {
        pending += 1;
        call.counted = true;
      }
    },
    afterLastSend: (fn) => {
      waiters.push(fn);
      settled();
    },
  };
}
