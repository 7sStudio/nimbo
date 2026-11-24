// /n/<name>/… (04-kernel §8): the notebooks' routes, the one surface without a token, since a webhook sender has none.
// The method, the path, the query (as the URL parser keeps it), the headers and the raw body (base64) go to the notebook's kernel, and its
// answer comes back; what of each passes is routeCredentials.ts (no daemon credential to user code, no CORS header to
// the sender). A path no route answers is 404: nothing else exists below /n/.
import type { IncomingMessage, ServerResponse } from "node:http";

import type { RouteResponse } from "@jsnb/core";

import type { Log } from "../events/log.js";
import { readRawBody, sendStatus } from "./respond.js";
import { answerHeaders, headersFor, searchFor } from "./routeCredentials.js";

export const routesPrefix = "/n/";

type RouteCall = {
  readonly method: string;
  readonly pathname: string;
  /** The query as sent, `""` or `?…`. */
  readonly search: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;
};

/** The kernel's answer to a route call; undefined when no open notebook's route is there. */
export type Routes = (call: RouteCall, signal: AbortSignal) => Promise<RouteResponse | undefined>;

/** Statuses whose answer has no body and no Content-Length (RFC 9110 §8.6, §15.3.5, §15.4.5). */
const bodiless = new Set([204, 304]);

/** A plain-text answer of the daemon's own. */
function writeText(response: ServerResponse, status: number, message: string): void {
  const text = Buffer.from(message);
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": text.length,
  });
  response.end(text);
}

/**
 * The Content-Length of an answer of `bytes`: their count, or for a HEAD answered without a body (a HEAD route's own
 * Response) the length its handler declared, the size the GET would have.
 */
function lengthOf(head: boolean, bytes: Buffer, answer: RouteResponse): number {
  const declared = answer.headers["content-length"];
  const length = typeof declared === "string" && /^\d+$/.test(declared) ? Number(declared) : NaN;
  return head && bytes.length === 0 && Number.isSafeInteger(length) ? length : bytes.length;
}

/** The kernel's answer: its headers as routeCredentials passes them, its bytes unless it is a HEAD's or bodiless. */
function writeAnswer(response: ServerResponse, head: boolean, answer: RouteResponse): void {
  const headers = answerHeaders(answer);
  if (bodiless.has(answer.status)) {
    response.writeHead(answer.status, headers);
    response.end();
    return;
  }
  const bytes = Buffer.from(answer.body, "base64");
  response.writeHead(answer.status, {
    ...headers,
    "content-length": lengthOf(head, bytes, answer),
  });
  response.end(head ? undefined : bytes);
}

/** The request's raw body; "large" past the daemon's limit, "left" when the sender went away while it was read. */
async function bodyOf(request: IncomingMessage): Promise<Buffer | "large" | "left"> {
  try {
    return (await readRawBody(request)) ?? "large";
  } catch (error) {
    if (!request.destroyed) throw error;
    return "left";
  }
}

/** What the kernel gets of the request: what routeCredentials lets through, the body base64. */
const callOf = (request: IncomingMessage, url: URL, token: string, body: Buffer) => ({
  ...{
    method: request.method ?? "GET",
    pathname: url.pathname,
    search: searchFor(url.search, token),
  },
  ...{ headers: headersFor(request.headers, token), rawBody: body.toString("base64") },
});

export type RouteRequest = {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly url: URL;
  readonly token: string;
  readonly routes: Routes;
  readonly log: Log;
};

/** Answers a request below /n/. */
export async function answerRoute({
  request,
  response,
  url,
  token,
  routes,
  log,
}: RouteRequest): Promise<void> {
  const gone = new AbortController();
  const left = (): void => {
    log.debug({ path: url.pathname }, "a route's sender went away before its answer");
  };
  const body = await bodyOf(request);
  if (body === "left") left(); // the sender left while its body was read
  if (body === "left" || body === "large") {
    if (body === "large") sendStatus(response, 413);
    return;
  }
  response.once("close", () => {
    if (!response.writableFinished) gone.abort(); // the client left: the kernel's work for it is cancelled
  });
  const call = callOf(request, url, token, body);
  let answer: RouteResponse | undefined;
  try {
    answer = await routes(call, gone.signal);
  } catch (error) {
    if (!gone.signal.aborted) throw error;
  }
  if (gone.signal.aborted) {
    left(); // the sender left: nobody waits for an answer, and nothing failed
    return;
  }
  if (answer) writeAnswer(response, request.method === "HEAD", answer);
  else writeText(response, 404, `No route at ${url.pathname}.`);
}
