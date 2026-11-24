// The paced downloads of the browser test server: a .wasm request under /@fs/ with the cookie gets the whole
// file in slices a pause apart, whatever revalidation it asked for; any other request goes on to the next handler. A
// real HTTP server, a real file.
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import { pace, pacedCookie, pacedMiddleware } from "./pacedDownloads.js";
import { withWorkspace } from "./workspace.js";

/** Runs `use` against a server whose requests go through the middleware; answers the paths it passed on. */
async function serve(use: (url: string) => Promise<void>): Promise<string[]> {
  const passed: string[] = [];
  const server = createServer((request, response) => {
    pacedMiddleware(request, response, () => {
      passed.push(request.url ?? "");
      response.end("next");
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const { port } = server.address() as AddressInfo;
    await use(`http://127.0.0.1:${String(port)}`);
  } finally {
    await new Promise((done) => server.close(done));
  }
  return passed;
}

/** The body's chunks, each with when it arrived. */
async function chunks(response: Response): Promise<{ bytes: number; at: number }[]> {
  const arrived: { bytes: number; at: number }[] = [];
  const reader = response.body?.getReader();
  for (
    let read = await reader?.read();
    read !== undefined && !read.done;
    read = await reader?.read()
  ) {
    const chunk: unknown = read.value;
    arrived.push({
      bytes: chunk instanceof Uint8Array ? chunk.byteLength : 0,
      at: performance.now(),
    });
  }
  return arrived;
}

describe("pacedMiddleware", () => {
  it("answers a .wasm with the cookie whole, in slices a pause apart, even to a revalidation", async () => {
    await withWorkspace(async (ws) => {
      const file = ws.path("engine.wasm");
      const body = Buffer.alloc(8 * 64 * 1024, 7);
      await writeFile(file, body);
      let arrived: { bytes: number; at: number }[] = [];
      const passed = await serve(async (url) => {
        const response = await fetch(`${url}/@fs${file}`, {
          headers: { cookie: `other=1; ${pacedCookie}=1`, "if-none-match": '"x"' },
        });
        expect([response.status, response.headers.get("content-length")]).toEqual([
          200,
          String(body.length),
        ]);
        arrived = await chunks(response);
      });
      expect(passed).toEqual([]);
      expect(arrived.reduce((sum, chunk) => sum + chunk.bytes, 0)).toBe(body.length);
      const gaps = arrived.slice(1).map((chunk, at) => chunk.at - (arrived[at]?.at ?? chunk.at));
      expect(gaps.filter((gap) => gap >= pace.pauseMs / 2).length).toBeGreaterThanOrEqual(
        pace.slices - 1,
      );
    });
  });
});

describe("pacedMiddleware's other requests", () => {
  it("passes on a request without the cookie, for another file, for a ?url module, or a .wasm not there", async () => {
    await withWorkspace(async (ws) => {
      const file = ws.path("engine.wasm");
      await writeFile(file, Buffer.alloc(16, 1));
      const cookie = { headers: { cookie: `${pacedCookie}=1` } };
      const passed = await serve(async (url) => {
        for (const [path, init] of [
          [`/@fs${file}`, {}],
          [`/@fs${ws.path("page.js")}`, cookie],
          [`/engine.wasm`, cookie],
          [`/@fs${file}?url`, cookie],
          [`/@fs${ws.path("gone.wasm")}`, cookie],
        ] as const)
          expect(await (await fetch(`${url}${path}`, init)).text()).toBe("next");
      });
      expect(passed).toHaveLength(5);
    });
  });
});
