// JSON-RPC 2.0 frames: what the daemon sends, read and validated with Zod, and the frames this
// client writes (requests, and its answers to the daemon's requests).
import type { ApiIssue } from "@jsnb/core";
import { z } from "zod";

import { issuesOf } from "./issues.js";
import type { WireError } from "./wireError.js";

export type RpcId = string | number;

/**
 * One frame from the daemon, by kind. `invalid` is a frame to answer with its JSON-RPC code (not JSON, a malformed
 * request); `badAnswer` is a malformed response, which fails the call its id names.
 */
export type Incoming =
  | { readonly kind: "result"; readonly id: RpcId; readonly result: unknown }
  | { readonly kind: "error"; readonly id: RpcId | null; readonly error: WireError }
  | {
      readonly kind: "request";
      readonly id: RpcId;
      readonly method: string;
      readonly params: unknown;
    }
  | { readonly kind: "notification"; readonly method: string; readonly params: unknown }
  | {
      readonly kind: "invalid";
      readonly code: number;
      readonly id: RpcId | null;
      readonly issues: Issues;
    }
  | { readonly kind: "badAnswer"; readonly id: RpcId | null; readonly issues: Issues };
type Issues = readonly ApiIssue[];

const version = z.literal("2.0");
const id = z.union([z.string(), z.number()]);
const wireError = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
});
const requestFrame = z.object({ jsonrpc: version, id, method: z.string(), params: z.unknown() });
const notificationFrame = z.object({ jsonrpc: version, method: z.string(), params: z.unknown() });
const errorFrame = z.object({ jsonrpc: version, id: id.nullable(), error: wireError });
const resultFrame = z.object({ jsonrpc: version, id, result: z.unknown() });

const invalid = (code: number, message: string): Incoming => ({
  kind: "invalid",
  code,
  id: null,
  issues: [{ path: [], message }],
});

/** The id of a frame that failed validation, when it has a readable one. */
const idOf = (frame: object): RpcId | null => {
  const parsed = id.safeParse("id" in frame ? frame.id : undefined);
  return parsed.success ? parsed.data : null;
};

type Read = <T>(schema: z.ZodType<T>, frame: object, build: (value: T) => Incoming) => Incoming;

/** A request or a notification: one that fails validation is answered with -32600. */
const readCall: Read = (schema, frame, build) => {
  const parsed = schema.safeParse(frame);
  if (parsed.success) return build(parsed.data);
  return { kind: "invalid", code: -32600, id: idOf(frame), issues: issuesOf(parsed.error) };
};

/** A response: one that fails validation fails the call it answers. */
const readAnswer: Read = (schema, frame, build) => {
  const parsed = schema.safeParse(frame);
  if (parsed.success) return build(parsed.data);
  return { kind: "badAnswer", id: idOf(frame), issues: issuesOf(parsed.error) };
};

/** Sorts a parsed frame by the members it has, then checks the members of that kind. */
function classify(frame: unknown): Incoming {
  if (typeof frame !== "object" || frame === null || Array.isArray(frame)) {
    return invalid(-32600, "expected a JSON-RPC object");
  }
  if ("method" in frame && "id" in frame) {
    return readCall(requestFrame, frame, (f) => ({
      kind: "request",
      id: f.id,
      method: f.method,
      params: f.params,
    }));
  }
  if ("method" in frame) {
    return readCall(notificationFrame, frame, (f) => ({
      kind: "notification",
      method: f.method,
      params: f.params,
    }));
  }
  if ("error" in frame) {
    return readAnswer(errorFrame, frame, (f) => ({ kind: "error", id: f.id, error: f.error }));
  }
  if ("result" in frame) {
    return readAnswer(resultFrame, frame, (f) => ({ kind: "result", id: f.id, result: f.result }));
  }
  return invalid(-32600, "expected a result, an error, a request or a notification");
}

/** Reads one frame of text; text that is not JSON is `invalid` with -32700. */
export function readFrame(text: string): Incoming {
  let frame: unknown;
  try {
    frame = JSON.parse(text);
  } catch (error) {
    // Not JSON is a frame to answer with -32700, not a failure of this client.
    return invalid(-32700, error instanceof Error ? error.message : "not JSON");
  }
  return classify(frame);
}

/** A request frame: this client's call. */
export const writeRequest = (callId: number, method: string, params: unknown): string =>
  JSON.stringify({ jsonrpc: "2.0", id: callId, method, params });

/** A result frame: this client's answer to a daemon request; an absent result is `null`. */
export const writeResult = (callId: RpcId, result: unknown): string =>
  JSON.stringify({ jsonrpc: "2.0", id: callId, result: result ?? null });

/** An error frame: this client's failed answer, or its reply to a frame it could not read. */
export const writeError = (callId: RpcId | null, error: WireError): string =>
  JSON.stringify({ jsonrpc: "2.0", id: callId, error });
