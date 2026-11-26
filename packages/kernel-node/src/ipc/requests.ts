// The requests that a `result` answers (call, snapshot, bindings, route): a fresh integer id per
// request, settled by the result with that id; an abort rejects at once, says which request was abandoned (so the
// kernel never starts it, if it has not yet), and the late result is ignored; the kernel's death rejects them all.
import type { KernelMessage } from "./messages.js";

export type ResultMessage = Extract<KernelMessage, { type: "result" }>;

type Waiting = {
  readonly resolve: (result: ResultMessage) => void;
  readonly reject: (error: Error) => void;
  readonly detach: () => void;
};

export type Requests = {
  /** A new request id and the promise of its result; `abandoned` hears its id when its signal aborts before it. */
  readonly open: (
    signal?: AbortSignal,
    abandoned?: (id: number) => void,
  ) => {
    readonly id: number;
    readonly result: Promise<ResultMessage>;
  };
  /** A result arrived; an id nobody waits for (aborted, unknown) is ignored. */
  readonly settle: (result: ResultMessage) => void;
  /** Rejects the pending request `id` with `error` (a message of it that could not be sent). */
  readonly fail: (id: number, error: Error) => void;
  /** Rejects every pending request with `error`. */
  readonly failAll: (error: Error) => void;
};

/** The abort reason as an error: a signal's own reason (an AbortError by default) or one built from it. */
const abortError = (signal: AbortSignal): Error => {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new DOMException(String(reason), "AbortError");
};

/** No pending requests yet. */
export function createRequests(): Requests {
  const waiting = new Map<number, Waiting>();
  let lastId = 0;
  return {
    open: (signal, abandoned) => {
      lastId += 1;
      const id = lastId;
      const result = new Promise<ResultMessage>((resolve, reject) => {
        if (signal?.aborted) {
          reject(abortError(signal));
          return;
        }
        const abort = (): void => {
          waiting.delete(id);
          if (signal) reject(abortError(signal));
          abandoned?.(id);
        };
        signal?.addEventListener("abort", abort, { once: true });
        waiting.set(id, {
          resolve,
          reject,
          detach: () => signal?.removeEventListener("abort", abort),
        });
      });
      return { id, result };
    },
    settle: (result) => {
      const entry = waiting.get(result.id);
      waiting.delete(result.id);
      entry?.detach();
      entry?.resolve(result);
    },
    fail: (id, error) => {
      const entry = waiting.get(id);
      waiting.delete(id);
      entry?.detach();
      entry?.reject(error);
    },
    failAll: (error) => {
      for (const entry of waiting.values()) {
        entry.detach();
        entry.reject(error);
      }
      waiting.clear();
    },
  };
}
