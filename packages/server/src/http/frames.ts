// JSON-RPC 2.0 frames of 03-api §7.2 and §7.3 on the daemon's side: a client's call, a notification (a call without an
// id, carried out and never answered), a page's answer to the daemon's own request, or a frame that is no message
// (-32700 not JSON, -32600 not a JSON-RPC message, a batch included: one call per message); and what the daemon writes.
import { z } from "zod";

import type { Answer } from "../commands/dispatch.js";
import type { WireError } from "../commands/wireError.js";

export type RpcId = string | number;

export type Incoming =
  | { readonly kind: "call"; readonly id: RpcId; readonly method: string; readonly params: unknown }
  | { readonly kind: "notification"; readonly method: string; readonly params: unknown }
  | { readonly kind: "answer"; readonly id: RpcId; readonly result: unknown }
  | { readonly kind: "failure"; readonly id: RpcId | null; readonly error: WireError }
  | { readonly kind: "invalid"; readonly id: RpcId | null; readonly error: WireError };

const version = z.literal("2.0");
const id = z.union([z.string(), z.number()]);
const call = z.object({ jsonrpc: version, id, method: z.string(), params: z.unknown().optional() });
const notification = z.object({
  jsonrpc: version,
  method: z.string(),
  params: z.unknown().optional(),
});
const answer = z.object({ jsonrpc: version, id, result: z.unknown() });
const failure = z.object({
  jsonrpc: version,
  id: id.nullable(),
  error: z.object({ code: z.number().int(), message: z.string(), data: z.unknown().optional() }),
});

const invalid = (code: -32700 | -32600, message: string, frameId: RpcId | null): Incoming => ({
  kind: "invalid",
  id: frameId,
  error: { code, message },
});

const idOf = (frame: object): RpcId | null => {
  const parsed = id.safeParse("id" in frame ? frame.id : undefined);
  return parsed.success ? parsed.data : null;
};

function classify(frame: unknown): Incoming {
  if (Array.isArray(frame)) {
    return invalid(-32600, "Batches are not supported: send one JSON-RPC call per request.", null);
  }
  if (typeof frame !== "object" || frame === null) {
    return invalid(-32600, "A JSON-RPC message is an object.", null);
  }
  const asCall = call.safeParse(frame);
  if (asCall.success) {
    const { id: callId, method, params } = asCall.data;
    return { kind: "call", id: callId, method, params };
  }
  const asNotification = "id" in frame ? undefined : notification.safeParse(frame);
  if (asNotification?.success === true) {
    const { method, params } = asNotification.data;
    return { kind: "notification", method, params };
  }
  const asAnswer = answer.safeParse(frame);
  if (asAnswer.success)
    return { kind: "answer", id: asAnswer.data.id, result: asAnswer.data.result };
  const asFailure = failure.safeParse(frame);
  if (asFailure.success)
    return { kind: "failure", id: asFailure.data.id, error: asFailure.data.error };
  return invalid(
    -32600,
    'Not a JSON-RPC 2.0 call: it needs jsonrpc "2.0", an id and a method.',
    idOf(frame),
  );
}

/** Reads one frame of text. */
export function readIncoming(text: string): Incoming {
  let frame: unknown;
  try {
    frame = JSON.parse(text);
  } catch (error) {
    // Not JSON is a frame to answer with -32700, not a failure of the daemon.
    return invalid(
      -32700,
      `Parse error: ${error instanceof Error ? error.message : "not JSON"}`,
      null,
    );
  }
  return classify(frame);
}

/** A result frame; an absent result is `null`. NaN and Infinity become `null`, as JSON writes them. */
const writeResult = (frameId: RpcId, result: unknown): string =>
  JSON.stringify({ jsonrpc: "2.0", id: frameId, result: result ?? null });

export const writeError = (frameId: RpcId | null, error: WireError): string =>
  JSON.stringify({ jsonrpc: "2.0", id: frameId, error });

export const writeRequest = (frameId: RpcId, method: string, params: unknown): string =>
  JSON.stringify({ jsonrpc: "2.0", id: frameId, method, params });

export const writeNotification = (method: string, params: unknown): string =>
  JSON.stringify({ jsonrpc: "2.0", method, params });

/** The response to a call: its result, or its error; a result JSON cannot write (a BigInt) is a -32603. */
export function writeAnswer(frameId: RpcId, answer: Answer): string {
  if (!answer.ok) return writeError(frameId, answer.error);
  try {
    return writeResult(frameId, answer.result);
  } catch (error) {
    // JSON.stringify threw (a BigInt or a cycle in a result): the caller still gets an answer, a daemon bug as such.
    const name = error instanceof Error ? error.name : "Error";
    return writeError(frameId, {
      code: -32603,
      message: "The daemon's answer could not be written as JSON.",
      data: { name },
    });
  }
}
