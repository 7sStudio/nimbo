// GET /ui/… (02-architecture §7, the page cookie of): the built UI, with the bearer header or the page
// cookie; the first load of `/ui/<name>?token=<token>` with the right token also sets that cookie for /ui/ and /npm/
// (HttpOnly, SameSite=Strict, no Secure on http://127.0.0.1), so the page's later GETs of its assets and modules,
// which carry no header, are let in. Without a build the daemon answers a page that names the missing build.
import type { IncomingMessage, ServerResponse } from "node:http";

import type { PageCookie } from "./auth.js";
import { hasPageCredentials, isToken, pageCookies } from "./auth.js";
import { isRead, sendBareUnauthorized, sendReadOnly } from "./respond.js";

type UiFile =
  | { readonly kind: "file"; readonly body: Buffer; readonly type: string }
  | { readonly kind: "none" };

/** The file below /ui/ that a path names (still URL-encoded), or the build's index.html; `none` without a build. */
export type UiFiles = (rest: string) => Promise<UiFile>;

export type UiRequest = {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly url: URL;
  readonly token: string;
  readonly cookie: PageCookie;
  readonly ui: UiFiles;
};

const missingBuild = `<!doctype html>
<meta charset="utf-8">
<title>nimbo: the UI is not built</title>
<p>The daemon has no built UI to serve. Build it with <code>pnpm --filter @jsnb/ui build</code>, or start the daemon with the folder of a built UI.</p>
`;

const isUiPath = (pathname: string): boolean => pathname === "/ui" || pathname.startsWith("/ui/");

export { isUiPath };

/** The build's file, or the page naming the missing build; with the cookie on a first load. */
function sendFile(
  response: ServerResponse,
  found: UiFile,
  headers: Record<string, string | string[]>,
  head: boolean,
): void {
  const file = found.kind === "file" ? found : undefined;
  const body = file ? file.body : Buffer.from(missingBuild);
  response.writeHead(file ? 200 : 404, {
    ...headers,
    "content-type": file ? file.type : "text/html; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(head ? undefined : body);
}

/** Answers a request below /ui/. */
export async function answerUi({
  request,
  response,
  url,
  token,
  cookie,
  ui,
}: UiRequest): Promise<void> {
  if (!isRead(request)) {
    sendReadOnly(response);
    return;
  }
  const first = isToken(url.searchParams.get("token") ?? undefined, token);
  if (!first && !hasPageCredentials(request, token, cookie)) {
    sendBareUnauthorized(response);
    return;
  }
  const found = await ui(url.pathname.slice("/ui/".length));
  const set: Record<string, string[]> = first ? { "set-cookie": pageCookies(cookie) } : {};
  sendFile(response, found, set, request.method === "HEAD");
}
