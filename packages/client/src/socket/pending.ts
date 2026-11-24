// The calls a connection has issued and not yet settled, by JSON-RPC id, and which of them a dropped socket loses.
import type { OutgoingCall } from "../call/caller.js";
import { CallAborted } from "../errors/transport.js";
import { writeRequest } from "../rpc/frames.js";

type PendingCall = {
  readonly id: number;
  readonly method: string;
  readonly frame: string;
  readonly repeatable: boolean;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: unknown) => void;
};

export type PendingCalls = {
  readonly add: (call: PendingCall) => void;
  /** Removes and returns the call with this id, if it is still pending. */
  readonly take: (id: unknown) => PendingCall | undefined;
  /** The calls not yet written on the current socket, oldest first; from now on they count as written. */
  readonly unsent: () => readonly PendingCall[];
  /** After a drop: removes and returns the written calls that are not safe to repeat; the rest go out again. */
  readonly drop: () => readonly PendingCall[];
  /** Removes and returns every call. */
  readonly clear: () => readonly PendingCall[];
};

/** An empty table; ids are the connection's, increasing, so insertion order is call order. */
export function createPendingCalls(): PendingCalls {
  const calls = new Map<number, PendingCall>();
  const written = new Set<number>();
  return {
    add: (call) => {
      calls.set(call.id, call);
    },
    take: (id) => {
      if (typeof id !== "number") return undefined;
      const call = calls.get(id);
      calls.delete(id);
      written.delete(id);
      return call;
    },
    unsent: () => {
      const fresh = [...calls.values()].filter((call) => !written.has(call.id));
      for (const call of fresh) written.add(call.id);
      return fresh;
    },
    drop: () => {
      const lost = [...calls.values()].filter((call) => written.has(call.id) && !call.repeatable);
      for (const call of lost) calls.delete(call.id);
      written.clear();
      return lost;
    },
    clear: () => {
      const all = [...calls.values()];
      calls.clear();
      written.clear();
      return all;
    },
  };
}

/**
 * Adds `call` under `id` and resolves to its raw result. A signal that already aborted rejects at once; one that
 * aborts later withdraws the call (it is never sent if it was still waiting) and rejects with CallAborted.
 */
export function enlist(calls: PendingCalls, id: number, call: OutgoingCall): Promise<unknown> {
  const { method, signal, repeatable } = call;
  if (signal?.aborted === true) {
    return Promise.reject(new CallAborted({ method }, { cause: signal.reason }));
  }
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      calls.take(id)?.reject(new CallAborted({ method }, { cause: signal?.reason }));
    };
    const settled =
      <T>(done: (value: T) => void) =>
      (value: T): void => {
        signal?.removeEventListener("abort", abort);
        done(value);
      };
    const frame = writeRequest(id, method, call.params);
    calls.add({
      id,
      method,
      frame,
      repeatable,
      resolve: settled(resolve),
      reject: settled(reject),
    });
    signal?.addEventListener("abort", abort, { once: true });
  });
}
