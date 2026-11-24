// Credentials of 03-api §7.1 and the page cookie: `/rpc` takes the bearer header (HTTP) or `?token=` (the
// WebSocket upgrade) and never a cookie; `/outputs/…` and `/schema/settings.json` take the bearer header only (the page
// downloads through the client, which sends it); `/ui/…` and `/npm/…`, the two places a browser asks without a header
// (navigation, assets, `import()`), take the bearer header or the page cookie. That cookie is named after the daemon's
// port (`nimbo-<port>`, so two daemons never overwrite each other's) and holds the page key, 32 random bytes per start,
// never the token and never in server.json or a log; the first load of `/ui/<name>?token=<token>` sets it twice, for
// `/ui/` and for `/npm/`. The cookie is for browsers only: a request it alone authenticates must carry
// `Sec-Fetch-Site: same-origin` or `none`, which every browser that sends the cookie sends, so a page on another port
// of 127.0.0.1 (`same-site`) cannot use it, nor can a client without the header. Every comparison is constant-time.
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/** One daemon's page cookie: its name (the port is known once the daemon listens) and its value, the page key. */
export type PageCookie = { readonly name: () => string; readonly key: string };

/** The page cookie's name for the daemon on `port`. */
export const pageCookieName = (port: number): string => `nimbo-${String(port)}`;

/** Whether a cookie name is a nimbo page cookie, this daemon's or another's (routes never pass one to user code). */
export const isPageCookieName = (name: string): boolean => /^nimbo-\d+$/.test(name);

/** `true` when `candidate` is `secret`, compared in constant time. */
export function isToken(candidate: string | undefined, secret: string): boolean {
  if (candidate === undefined) return false;
  const given = Buffer.from(candidate);
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The token of an `Authorization: Bearer <token>` header. */
export function bearerOf(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  const match = header === undefined ? null : /^Bearer (\S+)$/.exec(header);
  return match?.[1];
}

/** The value of the cookie `name`. */
export function cookieOf(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie;
  if (header === undefined) return undefined;
  for (const pair of header.split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

/** The Set-Cookie values of a first page load: one for /ui/ and one for /npm/, never readable by scripts. */
export const pageCookies = (cookie: PageCookie): string[] =>
  ["/ui/", "/npm/"].map(
    (path) => `${cookie.name()}=${cookie.key}; HttpOnly; SameSite=Strict; Path=${path}`,
  );

/** Whether a browser sent the request from this daemon's own pages, or the user asked for it. */
const fromOwnPage = (request: IncomingMessage): boolean => {
  const site = request.headers["sec-fetch-site"];
  return site === "same-origin" || site === "none";
};

/** `/ui/` and `/npm/`: the bearer header, or this daemon's page cookie sent by a browser from its own pages. */
export const hasPageCredentials = (
  request: IncomingMessage,
  token: string,
  cookie: PageCookie,
): boolean =>
  isToken(bearerOf(request), token) ||
  (fromOwnPage(request) && isToken(cookieOf(request, cookie.name()), cookie.key));

/** `/outputs/` and `/schema/settings.json`: the bearer header only. */
export const hasBearer = (request: IncomingMessage, token: string): boolean =>
  isToken(bearerOf(request), token);
