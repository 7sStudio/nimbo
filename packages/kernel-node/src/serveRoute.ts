// A forwarded `route` request: the matching handler run under its cell's latest store with a
// Fetch Request, its result as the RouteResponse; a throw is a 500 and an error output on that cell; every handled
// request bumps the route's hits and is an event output, once the process hooks were checked, with its status,
// the type its body names, the time the handler took and the client its User-Agent names (the page's Activity).
import { performance } from "node:perf_hooks";

import type { RouteResponse } from "@jsnb/core";

import { requestType, textResponse, toRequest, toRouteResponse } from "./builtins/request.js";
import { callUserCode } from "./builtins/userCode.js";
import type { RouteMessage } from "./ipc/messages.js";
import { cut } from "./outputs/cut.js";
import type { Realm } from "./realm.js";
import type { ResultFields } from "./result.js";
import { reply } from "./result.js";
import type { Store } from "./store.js";

type Entry = NonNullable<ReturnType<Realm["routes"]["match"]>>;

/** The longest `type` an event output carries: a sender without a token chooses it, so it stays a short label. */
const typeMax = 200;

/** The longest `from`: the User-Agent's first product, a short name too. */
const fromMax = 40;

/** The kernel's clock for a request's time, taken before user code runs, which cannot replace it then. */
const now = performance.now.bind(performance);

/** The sender as its User-Agent's first product names it ("curl/8.7.1" is curl, "Stripe/1.0 (…)" Stripe), if any. */
function senderOf(message: RouteMessage): string | undefined {
  const agent = Object.entries(message.headers).find(([key]) => key.toLowerCase() === "user-agent");
  const product = agent?.[1].trim().split(/[\s/]/u)[0];
  return product === undefined || product === "" ? undefined : product;
}

/** The handler's answer; a throw, or a result HTTP cannot carry, becomes a short redacted 500. */
async function answer(
  realm: Realm,
  store: Store,
  entry: Entry,
  message: RouteMessage,
): Promise<RouteResponse> {
  try {
    const request = toRequest(realm.config.routeBase, message);
    const { handler } = entry; // a local, so the handler's frame is not named after the entry
    const result = await realm.stores.run(store, () => callUserCode(handler, undefined, [request]));
    return await toRouteResponse(result, entry.spec);
  } catch (error) {
    realm.reportError(store, error);
    const info = realm.errorInfo(error);
    return textResponse(500, cut(`${info.name}: ${info.message}`, 500));
  }
}

/** The response to one `route` message (404 when no route matches), with the hit and the event recorded. */
async function routeResult(realm: Realm, message: RouteMessage): Promise<RouteResponse> {
  const entry = realm.routes.match(message.method, message.path);
  if (!entry) {
    return textResponse(404, `No route for ${message.method.toUpperCase()} ${message.path}`);
  }
  const store: Store = {
    cell: entry.cell,
    execution: realm.lastExecution.get(entry.cell) ?? entry.execution,
  };
  const started = now();
  const response = await answer(realm, store, entry, message);
  const durationMs = Math.round((now() - started) * 10) / 10;
  const checked = realm.checkHooks(store);
  if (checked) await checked;
  const { redact } = realm.environment;
  const type = requestType(message);
  const from = senderOf(message);
  const data = {
    status: response.status,
    ...(type === undefined ? {} : { type: cut(redact(type), typeMax) }),
    durationMs,
    ...(from === undefined ? {} : { from: cut(redact(from), fromMax) }),
  };
  const name = redact(`${entry.method} ${entry.path}`);
  realm.sink.emit(store, { kind: "event", name, data, at: realm.clock() });
  realm.routes.hit(entry);
  return response;
}

/** Answers one `route` message with exactly one `result`, whatever its flow throws. */
export async function routeFlow(realm: Realm, message: RouteMessage): Promise<void> {
  let fields: ResultFields;
  try {
    fields = { value: await routeResult(realm, message) };
  } catch (error) {
    // A step of the kernel's own failed: the request is answered with that error.
    fields = { error: realm.errorInfo(error) };
  }
  reply(realm.send, message.id, fields);
}
