// Local state that starts over when what it was set against changes (08 §7: no watch that copies one ref into
// another). What is set is kept with the turn of the source it was set in, and a new turn wins: a writable computed.
import type { WritableComputedRef } from "vue";
import { computed, shallowRef } from "vue";

type Turn<S> = { readonly from: S };

/** `start(source)` until something is set; what is set lasts until `source()` changes (`Object.is`), even back. */
export function keyed<S, T>(source: () => S, start: (from: S) => T): WritableComputedRef<T> {
  // A new object each time the source changes, the same one while it does not.
  const turn = computed<Turn<S>>((previous) => {
    const from = source();
    return previous !== undefined && Object.is(previous.from, from) ? previous : { from };
  });
  const kept = shallowRef<{ readonly turn: Turn<S>; readonly value: T }>();
  return computed({
    get: () => {
      const now = turn.value;
      const set = kept.value;
      return set?.turn === now ? set.value : start(now.from);
    },
    set: (value) => {
      kept.value = { turn: turn.value, value };
    },
  });
}
