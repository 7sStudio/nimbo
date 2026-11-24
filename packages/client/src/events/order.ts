// The ordering rule of 02-architecture §4.2 as pure steps: events go out in seq order from the subscription's seq,
// each once; while the state is being fetched they are buffered; a missing seq asks for a resync.

/** What ordering reads of an event. */
export type Sequenced = { readonly seq: number };

/** Buffering until the state is fetched, then live from the last seq delivered. */
export type Ordering<E extends Sequenced> =
  | { readonly phase: "buffering"; readonly buffer: readonly E[] }
  | { readonly phase: "live"; readonly last: number };

/** The next ordering, the events to deliver now (in order), and whether a seq went missing. */
export type Step<E extends Sequenced> = {
  readonly ordering: Ordering<E>;
  readonly deliver: readonly E[];
  readonly gap: boolean;
};

/** Before the state arrives: every event is kept for later. */
export const buffering = <E extends Sequenced>(): Ordering<E> => ({
  phase: "buffering",
  buffer: [],
});

/** Delivers `events` (sorted) after `last`: seq ≤ last is a duplicate; seq > next is a gap that stops everything. */
function advance<E extends Sequenced>(last: number, events: readonly E[]): Step<E> {
  const deliver: E[] = [];
  let current = last;
  for (const event of events) {
    if (event.seq <= current) continue;
    if (event.seq !== current + 1) return { ordering: buffering(), deliver, gap: true };
    deliver.push(event);
    current = event.seq;
  }
  return { ordering: { phase: "live", last: current }, deliver, gap: false };
}

/** One event arrives: buffered before the state, delivered when it is the next seq, dropped or a gap otherwise. */
export function receive<E extends Sequenced>(ordering: Ordering<E>, event: E): Step<E> {
  if (ordering.phase === "live") return advance(ordering.last, [event]);
  return {
    ordering: { phase: "buffering", buffer: [...ordering.buffer, event] },
    deliver: [],
    gap: false,
  };
}

/** The state was read at `seq`: the buffered events above it are delivered in seq order, from seq + 1. */
export function start<E extends Sequenced>(ordering: Ordering<E>, seq: number): Step<E> {
  const buffered = ordering.phase === "buffering" ? ordering.buffer : [];
  return advance(
    seq,
    [...buffered].sort((a, b) => a.seq - b.seq),
  );
}
