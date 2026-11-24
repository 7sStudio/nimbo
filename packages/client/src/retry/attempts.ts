// The attempts of one outage of a WebSocket (03-api §7.6): the wait before each reconnect, and when to give up.
import type { Backoff } from "./backoff.js";
import { backoffMs } from "./backoff.js";

export type Attempts = {
  /** A socket is being opened: one more try in this outage. */
  readonly tried: () => void;
  /** It opened: the outage is over. */
  readonly succeeded: () => void;
  /** It closed: how long to wait before the next try, or undefined when the tries ran out. */
  readonly next: () => number | undefined;
  /** How many sockets this outage opened. */
  readonly count: () => number;
};

/** The initial connect counts as an outage; a drop of a live socket starts a new one with no try made yet. */
export function countAttempts(backoff: Backoff): Attempts {
  let tries = 0;
  let waits = 0;
  return {
    tried: () => {
      tries += 1;
    },
    succeeded: () => {
      tries = 0;
      waits = 0;
    },
    next: () => {
      if (tries >= backoff.attempts) return undefined;
      waits += 1;
      return backoffMs(waits, backoff);
    },
    count: () => tries,
  };
}
