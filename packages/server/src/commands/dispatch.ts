// One JSON-RPC call to its answer: the bound command for the method (-32601 when none), its
// handler run with the call's context, and the result or the call failure as the wire carries it.
import type { Log } from "../events/log.js";
import type { Bound } from "./bind.js";
import { OutputMismatch } from "./bind.js";
import type { CallContext } from "./context.js";
import type { WireError } from "./wireError.js";
import { MethodNotFound, toWireError } from "./wireError.js";

export type Answer =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: WireError };

export type Dispatch = (method: string, params: unknown, context: CallContext) => Promise<Answer>;

/** The dispatcher over a table of bound commands, keyed by name. */
export function createDispatch(table: ReadonlyMap<string, Bound>, log: Log): Dispatch {
  return async (method, params, context) => {
    const bound = table.get(method);
    try {
      if (!bound) throw new MethodNotFound(method);
      return { ok: true, result: await bound.run(params, context) };
    } catch (error) {
      if (error instanceof OutputMismatch) log.error({ ...error.data }, error.message);
      return { ok: false, error: toWireError(error, method, log) };
    }
  };
}
