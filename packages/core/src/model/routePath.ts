// The one form a route path takes where routes are compared and printed: `/n/<name>/<path>` matched by
// the daemon and the kernel, `routeUrl()` and `Route.url`. Each `/`-separated segment is percent-decoded and encoded
// again with encodeURIComponent, the encoding notebookName gives a notebook's segments, so `/café`, `/caf%C3%A9` and
// `/caf%c3%a9` are one path and a webhook sender's own escaping never decides whether a route answers.

/** `segment` percent-decoded, or as written when it holds a malformed escape (`%zz`, a lone `%`). */
function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // Not an escape: the segment's characters as they are, which the encoding below then escapes.
    return segment;
  }
}

/**
 * `path` in its route form: each segment decoded, then encoded with encodeURIComponent (`/a b/café` → `/a%20b/caf%C3%A9`).
 * Idempotent, and an encoded `/` (`%2F`) stays inside its segment, so `/a%2Fb` and `/a/b` are two paths.
 */
export const routePath = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(decoded(segment)))
    .join("/");
