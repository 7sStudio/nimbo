// What of a request below /n/ reaches user code, and what of its answer reaches the sender (03-api §7.1, 02-architecture
// §8): the daemon's own credentials never pass to a handler (a nimbo page cookie, and the token wherever the request
// carries it: a cookie pair, the Authorization header, a Referer from a page whose URL still held `?token=`, a query
// parameter), and an answer carries no CORS header, no hop-by-hop header and no nimbo page cookie.
import type { IncomingHttpHeaders } from "node:http";

import type { RouteResponse } from "@jsnb/core";

import { isPageCookieName } from "./auth.js";

/** The headers the daemon sets itself on an answer, or that only the connection between it and the sender owns. */
const dropped = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "upgrade",
]);

/** `text` percent-decoded with `+` as a space, or as written when it holds a malformed escape. */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text.replaceAll("+", " "));
  } catch {
    // A malformed escape: the text as sent is what a handler would read.
    return text;
  }
}

/** Whether `text`, as sent or decoded, holds the token. */
const holdsToken = (text: string, token: string): boolean =>
  text.includes(token) || decoded(text).includes(token);

/** Whether a cookie pair (or a Set-Cookie value) is a nimbo page cookie: none passes to or from user code. */
const isOwnCookie = (pair: string): boolean => isPageCookieName(pair.split("=")[0]?.trim() ?? "");

/** The cookie header without any nimbo page cookie pair, nor any pair holding the token. */
function cookiesFor(header: string, token: string): string | undefined {
  const kept = header
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair !== "" && !isOwnCookie(pair) && !holdsToken(pair, token));
  return kept.length > 0 ? kept.join("; ") : undefined;
}

/** The request's headers for user code, one string each: page cookies and every value holding the token taken out. */
export function headersFor(headers: IncomingHttpHeaders, token: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const text = Array.isArray(value) ? value.join(", ") : value;
    const kept = name === "cookie" ? cookiesFor(text, token) : text;
    if (kept !== undefined && !holdsToken(kept, token)) out[name] = kept;
  }
  return out;
}

/** The query as the URL parser keeps it (`""` or `?…`, empty pairs included), without a parameter that holds the token. */
export function searchFor(search: string, token: string): string {
  if (search === "") return "";
  const kept = search
    .slice(1)
    .split("&")
    .filter((pair) => !holdsToken(pair, token));
  return kept.length > 0 ? `?${kept.join("&")}` : "";
}

/** A header of the answer that reaches the sender: not CORS, not hop-by-hop, not a nimbo page cookie. */
function keptValue(name: string, value: string | readonly string[]): string | string[] | undefined {
  const lower = name.toLowerCase();
  if (lower.startsWith("access-control-") || dropped.has(lower)) return undefined;
  if (lower !== "set-cookie") return typeof value === "string" ? value : [...value];
  const cookies = (typeof value === "string" ? [value] : value).filter((v) => !isOwnCookie(v));
  return cookies.length > 0 ? cookies : undefined;
}

/** The answer's headers for the sender, each Set-Cookie its own line. */
export function answerHeaders(answer: RouteResponse): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(answer.headers)) {
    const kept = keptValue(name, value);
    if (kept !== undefined) out[name] = kept;
  }
  return out;
}
