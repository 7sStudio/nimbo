// The full-value endpoint's own rules: the bearer header only (the page downloads through
// the client, which sends it; the page cookie is no credential here), GET and HEAD only, 404 for a path that names no
// output; the value itself is proven through the client in notebook/session/runs/outputs.integration.test.ts. A caller
// that goes away mid-download is noted at debug, never as a failed request.
import { readFile } from "node:fs/promises";
import { request } from "node:http";

import { withDaemon } from "../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

import { logged } from "../fixtures/folders.js";
import { createNotebook } from "../fixtures/notebook.js";
import { bodyOf, pageCookie, rawHttp } from "../fixtures/raw.js";

describe("/outputs/<execution>/<index>.json", () => {
  it("takes the bearer header only, answers HEAD without a body, and refuses the rest", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: "a.jsnb" });
      const add = { notebook: "a.jsnb", type: "server" as const, source: "[1, 2]", run: true };
      const { execution } = await daemon.client.cell.add(add);
      const path = `/outputs/${execution?.id ?? ""}/0.json`;
      const get = (headers: Record<string, string>, method = "GET", at = path) =>
        rawHttp(daemon.server.port, { method, path: at, headers });
      const bearer = { authorization: `Bearer ${daemon.token}` };
      expect((await get(bearer)).body).toBe("[1,2]");
      const cookie = await pageCookie(daemon.server.port, daemon.token);
      expect((await get({ cookie: `other=1; ${cookie}` })).status).toBe(401);
      const head = await get(bearer, "HEAD");
      expect([head.status, head.body]).toEqual([200, ""]);
      const missing = await get({});
      expect(missing.status).toBe(401);
      expect(bodyOf(missing)).toMatchObject({ error: { code: 1006 } });
      const posted = await get(bearer, "POST");
      expect([posted.status, posted.headers.allow]).toEqual([405, "GET, HEAD"]);
      expect((await get(bearer, "GET", "/outputs/x/0")).status).toBe(404);
      expect((await get(bearer, "GET", "/outputs/%E0%A4%A/0.json")).status).toBe(404);
      const gone = await get(bearer, "GET", "/outputs/e_000000/0.json");
      expect(gone.status).toBe(404);
      expect(bodyOf(gone)).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32602 } });
    });
  });
});

describe("a download whose caller goes away mid-stream", () => {
  it("is noted at debug, never logged as a failed request", async () => {
    await withDaemon(
      async (daemon, ws) => {
        const book = await createNotebook(daemon);
        const big = "Array.from({ length: 200000 }, (_, i) => ({ i, text: 'x'.repeat(40) }))"; // some 11 MB
        const { execution } = await book.ran(big);
        const headers = { authorization: `Bearer ${daemon.token}` };
        const path = `/outputs/${execution.id}/0.json`;
        const asked = request(
          { host: "127.0.0.1", port: daemon.server.port, path, headers },
          (answer) => {
            answer.once("data", () => {
              asked.destroy(); // the caller leaves after the first chunk
            });
          },
        );
        asked.on("error", () => undefined); // its own end, as the test means it
        asked.end();
        const log = ws.path(".jsnb/logs/daemon.log");
        await logged(log, "a download's caller went away before its end");
        expect(await readFile(log, "utf8")).not.toContain("an HTTP request failed");
      },
      { logLevel: "debug" },
    );
  });
});
