// A Vite plugin for the browser test server: a request for a .wasm file under /@fs/ (the address a
// dependency's ?url import gives, asked with no query) that carries the cookie `jsnb-paced-download=1` is answered here, in full (a 200,
// never a 304, whatever the browser cached) and paced: the body in slices with a pause before each but the first.
// DuckDB-WASM 1.32.0 reports its download's progress only for a chunk that arrives 20 ms or more after the one
// before, so a download from the local server or the cache reported none; a test that sets the cookie gets a real
// download of the real engine at a pace that reports. Without the cookie, Vite answers as always.
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Plugin } from "vite";

/** The cookie a test sets on the page to pace the next .wasm downloads. */
export const pacedCookie = "jsnb-paced-download";

/** How many slices a paced body is sent in, and the pause before each one but the first. */
export const pace = { slices: 8, pauseMs: 40 } as const;

/** The absolute path of the .wasm file a paced request names, or undefined for any other request. */
function pacedFile(request: IncomingMessage): string | undefined {
  const cookie = new RegExp(`(^|;\\s*)${pacedCookie}=1(;|$)`, "u");
  if (!cookie.test(request.headers.cookie ?? "")) return undefined;
  const url = new URL(request.url ?? "/", "http://test");
  const path = decodeURIComponent(url.pathname);
  // the file itself, never the module of its ?url import (`…/duckdb-eh.wasm?url`), which is JavaScript
  const asset = url.search === "" && path.startsWith("/@fs/") && path.endsWith(".wasm");
  return asset ? path.slice("/@fs".length) : undefined;
}

const pause = (ms: number) =>
  new Promise<void>((done) => {
    setTimeout(done, ms);
  });

/** Answers `body` in `pace.slices` slices, a pause before each but the first. */
async function paced(response: ServerResponse, body: Buffer): Promise<void> {
  response.writeHead(200, {
    "content-type": "application/wasm",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  const size = Math.ceil(body.length / pace.slices);
  for (let at = 0; at < body.length; at += size) {
    if (at > 0) await pause(pace.pauseMs);
    if (response.destroyed) return;
    response.write(body.subarray(at, at + size));
  }
  response.end();
}

/** The middleware: answers a paced request itself, and passes every other request on. */
export function pacedMiddleware(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
): void {
  const file = pacedFile(request);
  if (file === undefined) {
    next();
    return;
  }
  void readFile(file).then(
    (body) =>
      paced(response, body).catch(() => {
        response.destroy(); // the page went away mid-download: nothing more to send
      }),
    () => {
      next(); // no such file: Vite answers it as it would
    },
  );
}

/** The plugin: paces the .wasm downloads of a page that set the cookie. */
export function pacedDownloads(): Plugin {
  return {
    name: "jsnb-paced-downloads",
    configureServer(server) {
      server.middlewares.use(pacedMiddleware);
    },
  };
}
