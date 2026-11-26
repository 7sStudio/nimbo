// GET /outputs/<execution>/<index>.json: one retained full value streamed as JSON, with the bearer header
// only (the page downloads through the client, which sends it; the page cookie is no credential here); a
// value that is not retained is 404 with the JSON-RPC error body the client raises as its ApiError (INVALID_PARAMS
// naming the execution or the index).
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { toWireError } from "../commands/wireError.js";
import type { Log } from "../events/log.js";
import { hasBearer } from "./auth.js";
import { jsonChunks } from "./jsonStream.js";
import { isRead, sendError, sendReadOnly, sendStatus, sendUnauthorized } from "./respond.js";

export const outputsPrefix = "/outputs/";

/** Finds the full value of output `index` of `execution`, or throws the error the caller gets. */
export type FullValue = (execution: string, index: number) => Promise<{ readonly json: unknown }>;

type ValueRef = { readonly execution: string; readonly index: number };

/** The execution and index of `/outputs/<execution>/<index>.json`, or undefined. */
function refOf(pathname: string): ValueRef | undefined {
  const match = /^\/outputs\/([^/]+)\/(0|[1-9]\d{0,8})\.json$/.exec(pathname);
  if (!match?.[1] || match[2] === undefined) return undefined;
  try {
    return { execution: decodeURIComponent(match[1]), index: Number(match[2]) };
  } catch {
    return undefined; // a malformed escape names no execution: 404
  }
}

export type OutputRequest = {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly pathname: string;
  readonly token: string;
  readonly fullValue: FullValue;
  readonly log: Log;
};

/** Streams the value `ref` names, or the 404 of a value that is not retained. */
async function sendValue(output: OutputRequest, ref: ValueRef): Promise<void> {
  const { request, response } = output;
  let value: { readonly json: unknown };
  try {
    value = await output.fullValue(ref.execution, ref.index);
  } catch (error) {
    sendError(response, 404, toWireError(error, `GET ${output.pathname}`, output.log));
    return;
  }
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  if (request.method === "HEAD") response.end();
  else await streamed(output, value.json);
}

/**
 * The value's JSON text streamed to the caller. A caller that goes away mid-stream (a cancelled download, `| head`)
 * is noted at debug: no failure of the daemon; anything else stays the request's failure.
 */
async function streamed(output: OutputRequest, json: unknown): Promise<void> {
  try {
    await pipeline(Readable.from(jsonChunks(json)), output.response);
  } catch (error) {
    if (!callerLeft(error)) throw error;
    output.log.debug(
      { err: error, url: output.request.url },
      "a download's caller went away before its end",
    );
  }
}

/** The errors of a caller that closed its connection mid-stream: the response closed early, reset, or broken. */
const callerLeft = (error: unknown): boolean => {
  const code: unknown = error instanceof Error ? Reflect.get(error, "code") : undefined;
  return code === "ERR_STREAM_PREMATURE_CLOSE" || code === "ECONNRESET" || code === "EPIPE";
};

/** Answers a request below /outputs/. */
export async function answerOutput(output: OutputRequest): Promise<void> {
  const { request, response } = output;
  const ref = refOf(output.pathname);
  if (!ref) sendStatus(response, 404);
  else if (!isRead(request)) {
    sendReadOnly(response);
  } else if (!hasBearer(request, output.token)) sendUnauthorized(response);
  else await sendValue(output, ref);
}
