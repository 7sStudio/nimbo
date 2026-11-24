// The answer to a request of 04-kernel §2.1 (call, snapshot, bindings, route): one `result` message with its id.
import type { ErrorInfo } from "@jsnb/core";

import type { CallRefusal, KernelMessage } from "./ipc/messages.js";

export type ResultFields =
  | { readonly value: unknown; readonly redacted?: boolean }
  | { readonly error: ErrorInfo; readonly refused?: CallRefusal };

/** Sends the `result` of request `id`. */
export function reply(
  send: (message: KernelMessage) => void,
  id: number,
  fields: ResultFields,
): void {
  send({ type: "result", id, ...fields });
}

type Settled =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: unknown };

/** Runs user code to its settled value: a throw or a rejection is an outcome here, not an exception. */
export async function settle(run: () => unknown): Promise<Settled> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    // The flow reports it: as the run's status, the request's error, or an error output.
    return { ok: false, error };
  }
}
