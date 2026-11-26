// Exponential backoff for HTTP retries and WebSocket reconnects, and a pause that an
// AbortSignal cuts short.

/** At most `attempts` tries in a row; the n-th wait lasts min(maxMs, baseMs · 2^(n − 1)). */
export type Backoff = {
  readonly attempts: number;
  readonly baseMs: number;
  readonly maxMs: number;
};

/** HTTP: five attempts over about 1.5 s, enough for a daemon that is starting. */
export const httpBackoff: Backoff = { attempts: 5, baseMs: 100, maxMs: 2_000 };

/** WebSocket: reconnect for as long as it takes (the UI), from 250 ms up to 5 s between attempts. */
export const socketBackoff: Backoff = {
  attempts: Number.POSITIVE_INFINITY,
  baseMs: 250,
  maxMs: 5_000,
};

/** How long the n-th wait (n ≥ 1) lasts. */
export const backoffMs = (wait: number, backoff: Backoff): number =>
  Math.min(backoff.maxMs, backoff.baseMs * 2 ** (wait - 1));

/** Resolves true after `ms`, or false as soon as `signal` aborts (at once when it already has). */
export function pause(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve(false);
      return;
    }
    const abort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve(true);
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
