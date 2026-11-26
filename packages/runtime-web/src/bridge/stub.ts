// The async stub a client cell gets for an exported server function: encode, call, time out, decode.
import { ArgumentNotSerializable, RpcTimeout, bridgeCall, decode, encodeStrict } from "@jsnb/core";

import { stubFailure } from "./rebuild.js";
import type { RealmTransport } from "./transport.js";

export type StubContext = {
  readonly notebook: string;
  readonly transport: RealmTransport;
  /** `bridge.rpcTimeoutMs`. */
  readonly rpcTimeoutMs: number;
  /** `bridge.maxBytesPerValue`: bytes cross whole up to it, in both directions. */
  readonly maxBytesPerValue: number;
  /** The kernel redacted a secret in the result of `fn`: the calling cell gets a stderr warning. */
  readonly onRedacted: (fn: string) => void;
  /** The time the server kernel spends paused in the debugger, which a call's timeout does not count. */
  readonly pauses: PauseClock;
};

/** Whether the server kernel is paused in the debugger, and for how long it was so far (the pause under way not
 * counted): the page's host keeps it from the debugger's events. */
export type PauseClock = { readonly paused: () => boolean; readonly heldMs: () => number };

/** How often a call whose time ran out while the kernel was paused looks again. */
const pollMs = 250;

// The real timers, captured when the module loads, so a cell that replaces window.setTimeout changes nothing here.
const startTimer = globalThis.setTimeout.bind(globalThis);
const stopTimer = globalThis.clearTimeout.bind(globalThis);

/** The first path segment of a strict-mode failure is the argument's index in the arguments array. */
const argIndexOf = (path: readonly (string | number)[]): number =>
  typeof path[0] === "number" ? path[0] : 0;

/** Races the call against the timeout, the time paused in the debugger not counted; a late answer after the timeout is
 * ignored. */
async function withTimeout(
  call: Promise<unknown>,
  timeoutMs: number,
  pauses: PauseClock,
  timedOut: () => Error,
): Promise<unknown> {
  let timer: ReturnType<typeof startTimer> | undefined;
  let deadline = performance.now() + timeoutMs;
  let held = pauses.heldMs();
  const timeout = new Promise<never>((_resolve, reject) => {
    const check = (): void => {
      const extra = pauses.heldMs() - held;
      held += extra;
      deadline += extra;
      const left = deadline - performance.now();
      if (pauses.paused()) timer = startTimer(check, pollMs);
      else if (left > 0) timer = startTimer(check, left);
      else reject(timedOut());
    };
    timer = startTimer(check, timeoutMs);
  });
  try {
    return await Promise.race([call, timeout]);
  } finally {
    stopTimer(timer);
  }
}

/**
 * `(...args) => Promise`: the arguments array is encoded once in strict mode, so a reference shared by two arguments
 * survives; a value that cannot cross rejects before anything is sent. Concurrent calls are independent.
 */
export function createStub(
  name: string,
  context: StubContext,
): (...args: unknown[]) => Promise<unknown> {
  return async (...args: unknown[]): Promise<unknown> => {
    const limit = context.maxBytesPerValue;
    const encoded = encodeStrict(args, { maxBytesPerValue: limit });
    if (!encoded.ok) {
      const { path, type, bytes } = encoded.error;
      const sized = bytes === undefined ? {} : { bytes, limit };
      throw new ArgumentNotSerializable({ name, argIndex: argIndexOf(path), type, ...sized });
    }
    const wireArgs = Array.isArray(encoded.json) ? encoded.json : [];
    const call = context.transport.call("bridge.call", {
      notebook: context.notebook,
      fn: name,
      args: wireArgs,
    });
    const timedOut = () =>
      new RpcTimeout({ name, args: wireArgs, timeoutMs: context.rpcTimeoutMs });
    const answer = await withTimeout(call, context.rpcTimeoutMs, context.pauses, timedOut).catch(
      (failure: unknown) => {
        throw stubFailure(failure);
      },
    );
    const { result, redacted } = bridgeCall.output.parse(answer);
    if (redacted === true) context.onRedacted(name);
    return decode(result);
  };
}
