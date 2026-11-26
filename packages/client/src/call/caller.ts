// The typed call, `call(descriptor, input, options)`, over any transport: the input is typed from the
// command's input schema and validated by the daemon; the result is parsed with its output schema.
import type { CommandDescriptor, CommandTags } from "@jsnb/core";
import type { z } from "zod";

import { InvalidResponse } from "../errors/transport.js";
import { issuesOf } from "../rpc/issues.js";

export type CallOptions = {
  /** Stops waiting for the answer with CallAborted; the daemon may still carry the call out. */
  readonly signal?: AbortSignal;
};

/** A call typed from its descriptor: the input schema's input type in, the output schema's output type out. */
export type Caller = <I extends z.ZodObject, O extends z.ZodObject>(
  command: CommandDescriptor<I, O>,
  input: z.input<I>,
  options?: CallOptions,
) => Promise<z.output<O>>;

/** One JSON-RPC call as a transport sees it. */
export type OutgoingCall = {
  readonly method: string;
  readonly params: unknown;
  /** Whether sending it twice is safe (isRepeatable). */
  readonly repeatable: boolean;
  readonly signal?: AbortSignal;
};

/** Sends one call; resolves to the raw `result`, rejects with an ApiError or one of the client's errors. */
export type Transport = (call: OutgoingCall) => Promise<unknown>;

/**
 * Safe to send twice: tagged idempotent, or neither mutating, destructive nor internal. Destructive
 * commands change state even where they are not tagged mutating; internal ones (bridge.call, realm.report) belong to
 * a protocol whose owner recovers on reconnect.
 */
const isRepeatable = (tags: CommandTags): boolean =>
  tags.idempotent || !(tags.mutating || tags.destructive || tags.internal);

/** A typed call over `transport`; a result that fails the output schema is InvalidResponse. */
export function createCaller(transport: Transport): Caller {
  return async (command, input, options = {}) => {
    const result = await transport({
      method: command.name,
      params: input,
      repeatable: isRepeatable(command.tags),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const parsed = command.output.safeParse(result);
    if (!parsed.success) {
      throw new InvalidResponse({ method: command.name, issues: issuesOf(parsed.error) });
    }
    return parsed.data;
  };
}
