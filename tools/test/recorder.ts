// The daemon fixture's event recorder (no sleeps): every event a client received, and a wait for the
// first one of a type that a predicate accepts, received before the wait or after it.
import type { EventEnvelope, EventOf, EventType } from "@jsnb/core";

export type EventRecorder = {
  /** Every event received so far, in arrival order. */
  readonly all: () => readonly EventEnvelope[];
  /** The first event of `type` (received before or after the call) that `accept` accepts. */
  readonly until: <T extends EventType>(
    type: T,
    accept?: (event: EventOf<T>) => boolean,
    timeoutMs?: number,
  ) => Promise<EventOf<T>>;
};

type Waiter = {
  readonly accept: (event: EventEnvelope) => boolean;
  readonly resolve: (event: EventEnvelope) => void;
};

export function recorder(): EventRecorder & { readonly push: (event: EventEnvelope) => void } {
  const events: EventEnvelope[] = [];
  let waiters: Waiter[] = [];
  const isOf = <T extends EventType>(type: T, event: EventEnvelope): event is EventOf<T> =>
    event.type === type;
  return {
    push: (event) => {
      events.push(event);
      const ready = waiters.filter((waiter) => waiter.accept(event));
      waiters = waiters.filter((waiter) => !ready.includes(waiter));
      for (const waiter of ready) waiter.resolve(event);
    },
    all: () => events,
    until: (type, accept = () => true, timeoutMs = 10_000) =>
      new Promise((resolve, reject) => {
        const matches = (event: EventEnvelope): event is EventOf<typeof type> =>
          isOf(type, event) && accept(event);
        const found = events.find(matches);
        if (found) {
          resolve(found);
          return;
        }
        const timer = setTimeout(() => {
          reject(new Error(`no ${type} event within ${String(timeoutMs)} ms`));
        }, timeoutMs);
        waiters.push({
          accept: matches,
          resolve: (event) => {
            clearTimeout(timer);
            if (matches(event)) resolve(event);
          },
        });
      }),
  };
}
