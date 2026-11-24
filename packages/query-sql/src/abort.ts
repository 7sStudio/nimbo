// One signal from the caller's signal and a deadline, so a query stops on whichever comes first and knows which.
import type { QueryError } from "./errors.ts";
import { stopError } from "./errors.ts";

type Stop = "cancelled" | "timeout";

export type Deadline = {
  /** Aborts when the caller's signal aborts or the deadline passes. */
  readonly signal: AbortSignal;
  /** Which one fired first, if any. */
  stopped(): Stop | undefined;
  /** The QueryError for the stop that fired (`cancelled` when called before either fired). */
  error(): QueryError;
  /** Releases the timer and the listener on the caller's signal. */
  clear(): void;
};

/** Combines the caller's signal and a `timeoutMs` deadline; `Infinity` means no deadline. */
export function deadline(caller: AbortSignal | undefined, timeoutMs: number): Deadline {
  const controller = new AbortController();
  let stop: Stop | undefined;
  const fire = (reason: Stop) => {
    if (stop !== undefined) return;
    stop = reason;
    controller.abort(reason);
  };
  const onCallerAbort = () => {
    fire("cancelled");
  };
  const timer = Number.isFinite(timeoutMs)
    ? setTimeout(() => {
        fire("timeout");
      }, timeoutMs)
    : undefined;
  if (caller?.aborted === true) fire("cancelled");
  else caller?.addEventListener("abort", onCallerAbort, { once: true });
  return {
    signal: controller.signal,
    stopped: () => stop,
    error: () => stopError(stop ?? "cancelled", timeoutMs),
    clear: () => {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onCallerAbort);
    },
  };
}
