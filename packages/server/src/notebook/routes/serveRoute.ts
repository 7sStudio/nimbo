// Routes at /n/<name>/… (04-kernel §8, 03-api §4.4): the open notebook whose route name (kernel-node's routeName, the
// ref without `.jsnb`) prefixes the path gets the request, the path below its name forwarded to its kernel with a
// timeout of the daemon's own and the caller's signal (the HTTP client went away). The path is compared in core's
// route form (routePath), so `/n/caf%c3%a9/…` and `/n/a,b/…` reach `café.jsnb` and `a,b.jsnb` as their route URLs do.
// No open notebook there, or no kernel running: no route (the caller answers 404). The kernel itself answers 404
// when no route matches.
import type { RouteRequest, RouteResponse } from "@jsnb/core";
import { routePath } from "@jsnb/core";
import { routeName } from "@jsnb/kernel-node";

import { KernelRequestTimedOut, withTimeout } from "../../kernel/requests.js";
import type { Session } from "../session/session.js";

/** A route request as it arrives: the whole path below the daemon's root. */
export type RouteCall = Omit<RouteRequest, "path"> & { readonly pathname: string };

const text = (status: number, message: string): RouteResponse => ({
  status,
  headers: { "content-type": "text/plain; charset=utf-8" },
  body: Buffer.from(message).toString("base64"),
});

/** The open session whose route name is the longest prefix of `pathname`, with the path below it, in route form. */
function target(
  sessions: readonly Session[],
  pathname: string,
): { session: Session; path: string } | undefined {
  const form = routePath(pathname);
  let found: { session: Session; path: string; length: number } | undefined;
  for (const session of sessions) {
    const prefix = `/n/${routeName(session.ref)}`;
    const matches = form === prefix || form.startsWith(`${prefix}/`);
    if (matches && prefix.length > (found?.length ?? 0)) {
      found = { session, path: form.slice(prefix.length) || "/", length: prefix.length };
    }
  }
  return found;
}

/** The kernel's answer to `call`, a 504 past the timeout, a 502 when the kernel failed; undefined: no route there. */
export async function serveRoute(
  sessions: readonly Session[],
  call: RouteCall,
  waiting: { readonly signal: AbortSignal; readonly timeoutMs: number },
): Promise<RouteResponse | undefined> {
  const { signal, timeoutMs } = waiting;
  const found = target(sessions, call.pathname);
  const kernel = found?.session.context.kernel.live();
  if (!found || !kernel) return undefined;
  const { method, search, headers, rawBody } = call;
  const request = { method, path: found.path, search, headers, rawBody };
  try {
    return await withTimeout(
      "route",
      timeoutMs,
      (both) => kernel.handleRoute(request, { signal: both }),
      { caller: signal, pauses: found.session.context.kernel.pauses },
    );
  } catch (error) {
    if (error instanceof KernelRequestTimedOut) return text(504, error.message);
    if (signal.aborted) throw error;
    found.session.context.log.warn({ err: error }, "a route request failed in the kernel");
    return text(
      502,
      "The notebook's kernel could not answer this request. The details are in the daemon's log.",
    );
  }
}
