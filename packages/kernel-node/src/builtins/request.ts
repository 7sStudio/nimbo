// The Fetch side of a route: the forwarded request becomes a Request whose text() is the raw body,
// and the handler's result becomes the RouteResponse the daemon writes back, its body in base64.
import { Buffer } from "node:buffer";

import type { RouteRequest, RouteResponse } from "@jsnb/core";
import { typeName } from "@jsnb/core";

import { RouteResultInvalid } from "./errors.js";

const plainText = "text/plain; charset=utf-8";

const base64 = (text: string): string => Buffer.from(text, "utf8").toString("base64");

/** Captured when the module loads: a cell that replaces JSON's functions breaks its own code only. */
const json = { stringify: JSON.stringify.bind(JSON), parse: JSON.parse.bind(JSON) };

/** JSON.stringify as it behaves: a function, a symbol or undefined has no JSON text. */
const stringify = (value: unknown): string | undefined => json.stringify(value);

/** The Request a handler receives: `routeBase` plus the path and the query as sent, the headers, the raw body bytes. */
export function toRequest(routeBase: string, req: RouteRequest): Request {
  const url = new URL(`${routeBase}${req.path}${req.search}`);
  const method = req.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? null : Buffer.from(req.rawBody, "base64");
  return new Request(url, { method, headers: req.headers, body });
}

/** A plain-text response, as the 404 and 500 answers are. */
export function textResponse(status: number, text: string): RouteResponse {
  return { status, headers: { "content-type": plainText }, body: base64(text) };
}

/** A Response's headers, each Set-Cookie kept: a Headers object yields them one by one, which one record would lose. */
function headersOf(response: Response): RouteResponse["headers"] {
  const headers: Record<string, string | readonly string[]> = {};
  for (const [name, value] of response.headers) if (name !== "set-cookie") headers[name] = value;
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) headers["set-cookie"] = cookies;
  return headers;
}

/**
 * A handler's result as an HTTP answer: a Response as it is, a string as 200 text, undefined as 204, anything
 * else as 200 JSON. A value JSON.stringify cannot write throws (its own TypeError, or RouteResultInvalid).
 */
export async function toRouteResponse(result: unknown, spec: string): Promise<RouteResponse> {
  if (result instanceof Response && result.type === "error") {
    throw new RouteResultInvalid({ spec, type: "Response.error()" });
  }
  if (result instanceof Response) {
    const bytes = Buffer.from(await result.arrayBuffer());
    return { status: result.status, headers: headersOf(result), body: bytes.toString("base64") };
  }
  if (typeof result === "string") return textResponse(200, result);
  if (result === undefined) return { status: 204, headers: {}, body: "" };
  const json = stringify(result);
  if (json === undefined) throw new RouteResultInvalid({ spec, type: typeName(result) });
  return { status: 200, headers: { "content-type": "application/json" }, body: base64(json) };
}

/** The top-level string `type` of a JSON request body (a Stripe event's type), if there is one. */
export function requestType(req: RouteRequest): string | undefined {
  const text = Buffer.from(req.rawBody, "base64").toString("utf8");
  if (!text.trimStart().startsWith("{")) return undefined;
  try {
    const parsed: unknown = json.parse(text);
    const type: unknown =
      typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "type") : undefined;
    return typeof type === "string" ? type : undefined;
  } catch {
    // A body that only looks like JSON has no type to report; the handler still sees it whole.
    return undefined;
  }
}
