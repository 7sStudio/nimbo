// The typed answers of 04-kernel §2.1 on the daemon side: a `result` turned into what the Kernel interface returns,
// its value validated with Zod, or the named error of a failed request (BridgeCallFailed for a bridge call, CallRefused
// for one the kernel refused, KernelRequestFailed for the others), carrying the kernel's ErrorInfo.
import type {
  Binding as BindingType,
  BindingsOptions,
  BindingValue as BindingValueType,
  CallResult,
  RouteResponse as RouteResponseType,
  SnapshotBinding as SnapshotBindingType,
} from "@jsnb/core";
import {
  Binding,
  BindingValue,
  BridgeCallFailed,
  RouteResponse,
  SnapshotBinding,
} from "@jsnb/core";
import { z } from "zod";

import type { FailedRequest, ResultIssue } from "./errors.js";
import { CallRefused, KernelRequestFailed, KernelResultInvalid } from "./errors.js";
import type { ResultMessage } from "./requests.js";

/** A Zod issue as data: its path (symbols as text) and message. */
const issueOf = ({ path, message }: z.core.$ZodIssue): ResultIssue => ({
  path: path.map((key) => (typeof key === "symbol" ? String(key) : key)),
  message,
});

function valueOf<T>(result: ResultMessage, schema: z.ZodType<T>, request: FailedRequest): T {
  if (result.error) throw new KernelRequestFailed({ request, error: result.error });
  const parsed = schema.safeParse(result.value);
  if (parsed.success) return parsed.data;
  throw new KernelResultInvalid({ request, issues: parsed.error.issues.map(issueOf) });
}

/** A `call` result: the wire form and the redaction flag, BridgeCallFailed with the function's error, or CallRefused
 * when the kernel refused the call before running anything. */
export function callResultOf(result: ResultMessage): CallResult {
  if (result.error && result.refused)
    throw new CallRefused({ reason: result.refused, error: result.error });
  if (result.error) throw new BridgeCallFailed({ error: result.error });
  return { value: result.value, redacted: result.redacted === true };
}

const Snapshot = z.record(z.string(), SnapshotBinding);

/** A `snapshot` result: one SnapshotBinding per requested name. */
export const snapshotOf = (result: ResultMessage): Record<string, SnapshotBindingType> =>
  valueOf(result, Snapshot, "snapshot");

const Bindings = z.array(Binding).readonly();
const BindingValues = z.array(BindingValue).readonly();

/** A `bindings` result, with values when the request asked for `full`. */
export function bindingsOf(
  result: ResultMessage,
  options: BindingsOptions,
): readonly BindingType[] | readonly BindingValueType[] {
  return options.full === true
    ? valueOf(result, BindingValues, "bindings")
    : valueOf(result, Bindings, "bindings");
}

/** A `route` result: the handler's response, its body base64. */
export const routeResponseOf = (result: ResultMessage): RouteResponseType =>
  valueOf(result, RouteResponse, "route");

/** A `dispose` result: nothing, or KernelRequestFailed with the kernel's error. */
export const disposedOf = (result: ResultMessage): void => {
  valueOf(result, z.null(), "dispose");
};
