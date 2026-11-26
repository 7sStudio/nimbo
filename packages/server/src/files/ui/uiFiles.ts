// The built UI the daemon serves at /ui/: a file of the build by its path, never outside the
// build folder (no `..`, no symlink out) and never a directory, else the build's index.html, which the notebook page
// `/ui/<name>` and the output tab `/ui/<name>/out/<execution>/<index>` both load (the ui build uses `base: "/ui/"`);
// without a build, nothing, and the page says so. Files are read off the event loop and only when regular.
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

export type UiFile =
  | { readonly kind: "file"; readonly body: Buffer; readonly type: string }
  | { readonly kind: "none" };

const none: UiFile = { kind: "none" };

/** The largest UI file served: the build's chunks are far smaller. */
const maxBytes = 64 * 1024 * 1024;

const types: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

const typeOf = (path: string): string =>
  types[extname(path).toLowerCase()] ?? "application/octet-stream";

/** The bytes of `path` when it is a regular file inside `root` (its real path checked), else undefined. */
async function readInside(root: string, path: string): Promise<Buffer | undefined> {
  const real = await realpath(path).catch(() => undefined); // nothing there: the index answers instead
  if (real?.startsWith(`${root}${sep}`) !== true) return undefined;
  const handle = await open(real, constants.O_RDONLY | constants.O_NONBLOCK).catch(() => undefined);
  if (!handle) return undefined;
  try {
    const stats = await handle.stat();
    return stats.isFile() && stats.size <= maxBytes ? await handle.readFile() : undefined;
  } finally {
    await handle.close();
  }
}

/** The file below `/ui/` that `rest` names (still URL-encoded), or the build's index.html; `none` without a build. */
export async function uiFile(uiDir: string | undefined, rest: string): Promise<UiFile> {
  const root = uiDir === undefined ? undefined : await realpath(uiDir).catch(() => undefined);
  if (root === undefined) return none; // no build folder, or none at that path
  let decoded: string | undefined;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    decoded = undefined; // a malformed escape names no file: the index answers
  }
  const wanted =
    decoded === undefined || decoded.includes("\0") ? undefined : resolve(root, decoded);
  const body = wanted === undefined ? undefined : await readInside(root, wanted);
  if (body !== undefined && wanted !== undefined)
    return { kind: "file", body, type: typeOf(wanted) };
  const index = await readInside(root, join(root, "index.html"));
  return index === undefined ? none : { kind: "file", body: index, type: typeOf("index.html") };
}
