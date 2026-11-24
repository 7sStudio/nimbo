// The HTTP transport of 03-api §7.3: one JSON-RPC call per POST /rpc with the bearer token and the client headers.
import { Unauthorized } from "@jsnb/core";

import type { Transport } from "../call/caller.js";
import { httpHeaders } from "../daemon/address.js";
import { InvalidResponse } from "../errors/transport.js";
import { readFrame, writeRequest } from "../rpc/frames.js";
import { toApiError } from "../rpc/wireError.js";
import type { HttpOptions } from "./options.js";
import { exchangeRetrying } from "./retrying.js";

/** The result of the response to request `id`; 401 is Unauthorized, a JSON-RPC error its ApiError. */
async function readAnswer(response: Response, method: string, id: number): Promise<unknown> {
  if (response.status === 401) throw new Unauthorized();
  const frame = readFrame(await response.text());
  if (frame.kind === "result" && frame.id === id) return frame.result;
  if (frame.kind === "error" && (frame.id === id || frame.id === null))
    throw toApiError(frame.error);
  const issues =
    frame.kind === "invalid" || frame.kind === "badAnswer"
      ? frame.issues
      : [{ path: [], message: `expected the response to request ${String(id)}` }];
  throw new InvalidResponse({ method, issues });
}

/** A Transport over `POST <url>/rpc`, retried as exchangeRetrying allows. */
export function createHttpTransport(options: HttpOptions): Transport {
  let nextId = 1;
  return (call) => {
    const id = nextId;
    nextId += 1;
    return exchangeRetrying({
      options,
      method: call.method,
      path: "/rpc",
      init: {
        method: "POST",
        headers: { ...httpHeaders(options), "content-type": "application/json" },
        body: writeRequest(id, call.method, call.params),
      },
      repeatable: call.repeatable,
      ...(call.signal === undefined ? {} : { signal: call.signal }),
      read: (response) => readAnswer(response, call.method, id),
    });
  };
}
