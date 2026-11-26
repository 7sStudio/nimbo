// GET /npm/<spec>: the page's imports, with the bearer header or the page cookie; a
// module as JavaScript, the JSON-RPC error body (with its 4xx/5xx) that names the spec, which the page shows as the
// import's failure, or the bare 404 of a path the path rule refuses.
import type { IncomingMessage, ServerResponse } from "node:http";

import { toWireError } from "../commands/wireError.js";
import type { Log } from "../events/log.js";
import type { PageCookie } from "./auth.js";
import { hasPageCredentials } from "./auth.js";
import { isRead, sendBareUnauthorized, sendError, sendReadOnly, sendStatus } from "./respond.js";

export const npmPrefix = "/npm/";

type NpmModule =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly status: number; readonly error?: Error };

/** The module a path below /npm/ names (still URL-encoded); `signal` aborts once the client went away. */
export type NpmModules = (rest: string, signal: AbortSignal) => Promise<NpmModule>;

export type NpmRequest = {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly url: URL;
  readonly token: string;
  readonly cookie: PageCookie;
  readonly npm: NpmModules;
  readonly log: Log;
};

/** Answers a request below /npm/. */
export async function answerNpm({
  request,
  response,
  url,
  token,
  cookie,
  npm,
  log,
}: NpmRequest): Promise<void> {
  if (!isRead(request)) {
    sendReadOnly(response);
    return;
  }
  if (!hasPageCredentials(request, token, cookie)) {
    sendBareUnauthorized(response);
    return;
  }
  const gone = new AbortController();
  response.once("close", () => {
    if (!response.writableFinished) gone.abort(new Error("the client went away"));
  });
  const found = await npm(url.pathname.slice(npmPrefix.length), gone.signal);
  if (!found.ok) {
    if (found.error === undefined) sendStatus(response, found.status);
    else sendError(response, found.status, toWireError(found.error, `GET ${url.pathname}`, log));
    return;
  }
  const body = Buffer.from(found.body);
  response.writeHead(200, {
    "content-type": "text/javascript; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(request.method === "HEAD" ? undefined : body);
}
