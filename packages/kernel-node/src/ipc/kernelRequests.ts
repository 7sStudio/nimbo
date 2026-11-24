// The requests a NodeKernel sends (04-kernel §2.1): call, snapshot, bindings, route and dispose, each checked with the schema
// the kernel reads it with (InvalidParams at once, §11), with a fresh id and answered by the `result` with that id;
// each takes a signal last (§11): an aborted request rejects at once, leaves the pending table, and its late result is
// ignored. Its abort is also a `cancel` sent at once, never held behind an interrupt: it follows the request in the
// pipe, so a kernel that has not started the request never does.
import type {
  Binding,
  BindingsOptions,
  CellId,
  BindingValue,
  CallResult,
  RouteRequest,
  RouteResponse,
  SnapshotBinding,
} from "@jsnb/core";

import { bindingsOf, callResultOf, disposedOf, routeResponseOf, snapshotOf } from "./answers.js";
import type { Context } from "./kernelState.js";
import { live, send, write } from "./kernelState.js";
import type { DaemonMessage } from "./messages.js";
import { checkedMessage } from "./messages.js";
import type { ResultMessage } from "./requests.js";

export type RequestOptions = { readonly signal?: AbortSignal };

/** A bridge request's options: the notebook's `bridge.maxBytesPerValue` now, which wins over the launch one. */
type BridgeRequestOptions = RequestOptions & { readonly maxBytesPerValue?: number };

const limitOf = (options: BridgeRequestOptions) =>
  options.maxBytesPerValue === undefined ? {} : { maxBytesPerValue: options.maxBytesPerValue };

/** core's BindingsQuery with the request options every request takes last. */
type BindingsRequest = {
  (
    query: BindingsOptions & { readonly full: true },
    options?: RequestOptions,
  ): Promise<readonly BindingValue[]>;
  (query?: BindingsOptions, options?: RequestOptions): Promise<readonly Binding[]>;
};

export type KernelRequests = {
  readonly call: (
    fn: string,
    args: readonly unknown[],
    options?: BridgeRequestOptions,
  ) => Promise<CallResult>;
  readonly snapshot: (
    names: readonly string[],
    options?: BridgeRequestOptions,
  ) => Promise<Record<string, SnapshotBinding>>;
  readonly bindings: BindingsRequest;
  readonly handleRoute: (req: RouteRequest, options?: RequestOptions) => Promise<RouteResponse>;
  /** Runs the disposers of a deleted cell (04-kernel §7); resolves once they settled. */
  readonly dispose: (cell: CellId, options?: RequestOptions) => Promise<void>;
};

/** Tells the kernel the request `id` was abandoned, at once, past any send an interrupt holds; nothing once it died. */
function cancel(context: Context, id: number): void {
  const { session } = context.state;
  if (session) write(context, session, { type: "cancel", ids: [id] });
}

/** Sends the request `build` makes with a fresh id (unless `signal` already aborted) and resolves with its result. */
function ask(
  context: Context,
  build: (id: number) => DaemonMessage,
  signal?: AbortSignal,
): Promise<ResultMessage> {
  const session = live(context);
  checkedMessage(build(0));
  const { id, result } = context.requests.open(signal, (abandoned) => {
    cancel(context, abandoned);
  });
  if (!signal?.aborted) send(context, session, build(id));
  return result;
}

function bindingsRequest(context: Context): BindingsRequest {
  function bindings(
    query: BindingsOptions & { readonly full: true },
    options?: RequestOptions,
  ): Promise<readonly BindingValue[]>;
  function bindings(query?: BindingsOptions, options?: RequestOptions): Promise<readonly Binding[]>;
  async function bindings(query: BindingsOptions = {}, options: RequestOptions = {}) {
    const { names, full } = query;
    const fields = { ...(names ? { names } : {}), ...(full === undefined ? {} : { full }) };
    const result = await ask(
      context,
      (id) => ({ type: "bindings", id, ...fields }),
      options.signal,
    );
    return bindingsOf(result, query);
  }
  return bindings;
}

/** The request methods over `context`; each rejects KernelDead when the kernel is not running or dies first. */
export function kernelRequests(context: Context): KernelRequests {
  return {
    call: async (fn: string, args: readonly unknown[], options: BridgeRequestOptions = {}) => {
      const message = (id: number) => ({
        type: "call" as const,
        id,
        fn,
        args,
        ...limitOf(options),
      });
      return callResultOf(await ask(context, message, options.signal));
    },
    snapshot: async (names: readonly string[], options: BridgeRequestOptions = {}) => {
      const message = (id: number) => ({
        type: "snapshot" as const,
        id,
        names,
        ...limitOf(options),
      });
      return snapshotOf(await ask(context, message, options.signal));
    },
    bindings: bindingsRequest(context),
    handleRoute: async (req: RouteRequest, options: RequestOptions = {}) => {
      const result = await ask(context, (id) => ({ type: "route", id, ...req }), options.signal);
      return routeResponseOf(result);
    },
    dispose: async (cell: CellId, options: RequestOptions = {}) => {
      disposedOf(await ask(context, (id) => ({ type: "dispose", id, cell }), options.signal));
    },
  };
}
