// The full-value download: GET /outputs/<execution>/<index>.json with the bearer token, as a stream.
import { Unauthorized } from "@jsnb/core";

import type { CallOptions } from "../call/caller.js";
import { httpHeaders } from "../daemon/address.js";
import { InvalidResponse } from "../errors/transport.js";
import { readFrame } from "../rpc/frames.js";
import { toApiError } from "../rpc/wireError.js";
import type { HttpOptions } from "./options.js";
import { exchangeRetrying } from "./retrying.js";

/** Which retained value to download: one `value` output of one execution. */
export type ValueRef = { readonly execution: string; readonly index: number };

/** The error a non-2xx answer stands for: 401, else the JSON-RPC error of its body, else InvalidResponse. */
async function failureOf(response: Response, method: string): Promise<Error> {
  if (response.status === 401) return new Unauthorized();
  const frame = readFrame(await response.text());
  if (frame.kind === "error") return toApiError(frame.error);
  return new InvalidResponse({
    method,
    issues: [{ path: [], message: `HTTP status ${String(response.status)}` }],
  });
}

/**
 * The whole value of a `value` output past the 256 KB cap, as the daemon's streaming Response (2xx); a GET is safe
 * to repeat, so any network failure is retried. Read it with `response.body`, `.blob()` or `.json()`.
 */
export function downloadValue(
  options: HttpOptions,
  ref: ValueRef,
  callOptions: CallOptions = {},
): Promise<Response> {
  const path = `/outputs/${encodeURIComponent(ref.execution)}/${String(ref.index)}.json`;
  const method = `GET ${path}`;
  return exchangeRetrying({
    options,
    method,
    path,
    init: { method: "GET", headers: { ...httpHeaders(options), accept: "application/json" } },
    repeatable: true,
    ...(callOptions.signal === undefined ? {} : { signal: callOptions.signal }),
    read: async (response) => {
      if (response.ok) return response;
      throw await failureOf(response, method);
    },
  });
}
