// Every kernel request with an abort signal: a timeout of the daemon's own (bridge.rpcTimeoutMs for
// a bridge call), joined with the caller's signal when it has one; a request the timeout abandoned is cancelled in the
// kernel by kernel-node (`cancel { ids }`) and answered here with a named error rather than the signal's reason.
import { JsnbError } from "@jsnb/core";

import type { PauseClock } from "./pauses.js";
import { pausableTimer } from "./pauses.js";

/** How long the daemon waits for a snapshot or bindings request by default (a getter can spin; an interrupt can drop
 * one); startServer's `requestTimeoutMs` sets it. */
export const defaultRequestTimeoutMs = 10_000;

type Late = { readonly request: string; readonly timeoutMs: number };

/** A kernel request did not answer within the daemon's timeout; kernel-node cancelled it. */
export class KernelRequestTimedOut extends JsnbError {
  declare readonly data: Late;
  constructor(data: Late) {
    super({
      name: "KernelRequestTimedOut",
      message: `The kernel did not answer the ${data.request} request within ${String(data.timeoutMs / 1000)}s. The kernel may be busy; try kernel.interrupt.`,
      data,
    });
  }
}

/** A read of the kernel's names while it is paused in the debugger, which cannot answer before it resumes. */
export class KernelPaused extends JsnbError {
  constructor() {
    super({
      name: "KernelPaused",
      message:
        "The kernel is paused in the debugger. Read its names in the debugger (debug.scope), or resume it first.",
      data: {},
    });
  }
}

/** Runs `send` with a signal that aborts after `timeoutMs` (or with `caller`), the time the kernel spends paused in the
 * debugger (`pauses`) not counted; a timeout rejects KernelRequestTimedOut. */
export async function withTimeout<T>(
  request: string,
  timeoutMs: number,
  send: (signal: AbortSignal) => Promise<T>,
  options: { readonly caller?: AbortSignal | undefined; readonly pauses?: PauseClock } = {},
): Promise<T> {
  const timeout = new AbortController();
  const reason = new DOMException(`${request} timed out`, "TimeoutError");
  const timer = pausableTimer(timeoutMs, options.pauses, () => {
    timeout.abort(reason);
  });
  const { caller } = options;
  const signal = caller ? AbortSignal.any([timeout.signal, caller]) : timeout.signal;
  try {
    return await send(signal);
  } catch (error) {
    if (timeout.signal.aborted && error === reason)
      throw new KernelRequestTimedOut({ request, timeoutMs });
    throw error;
  } finally {
    timer.stop();
  }
}
