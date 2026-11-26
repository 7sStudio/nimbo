// The routes' surface: /n/<name>/… works without a token and reaches only
// user handlers; nothing else exists below /n/ (an unknown notebook, an unknown path, another method, a closed
// notebook, the daemon's own endpoints named below a notebook, a path that climbs out stays out and meets the token);
// the Host and Origin rules hold there as everywhere, and no answer below /n/ carries a CORS header, whatever the
// handler set.
import { describe, expect, it } from "vitest";

import { rawHttp } from "../../../fixtures/raw.js";
import { withRoutes } from "../../../fixtures/routes.js";

const ping = 'route("GET /ping", () => "pong")';

describe("below /n/", () => {
  it("answers a user handler without a token, a wrong one changing nothing", async () => {
    await withRoutes(async ({ cell, send, daemon }) => {
      await cell(ping);
      expect((await send("/ping")).body).toBe("pong");
      const wrong = { authorization: `Bearer ${daemon.token}x`, cookie: "nimbo-1=nope" };
      expect((await send("/ping", { headers: wrong })).body).toBe("pong");
    });
  });
});

/** Requests below /n/ that reach no user handler, with the token (it changes nothing), and the 404 each gets. */
const nothingThere: readonly (readonly [method: string, path: string, body: string])[] = [
  ["GET", "/n/", "No route at /n/."],
  ["GET", "/n/other/ping", "No route at /n/other/ping."],
  ["GET", "/n/hooksx/ping", "No route at /n/hooksx/ping."],
  ["POST", "/n/hooks/ping", "No route for POST /ping"],
  ["GET", "/n/hooks/nope", "No route for GET /nope"],
  ...["/rpc", "/ui/hooks", "/npm/zod", "/outputs/x_00000000/0.json", "/schema/settings.json"].map(
    (below) => ["GET", `/n/hooks${below}`, `No route for GET ${below}`] as const,
  ),
];

describe("nothing else below /n/", () => {
  it("exists: no notebook, no route, no method, no daemon endpoint below a notebook, a closed one: 404", async () => {
    await withRoutes(async ({ daemon, notebook, cell, send }) => {
      await cell(ping);
      const { port, token } = daemon.server;
      const headers = { authorization: `Bearer ${token}` };
      for (const [method, path, body] of nothingThere) {
        const answer = await rawHttp(port, { method, path, headers });
        expect([method, path, answer.status, answer.body]).toEqual([method, path, 404, body]);
      }
      expect((await rawHttp(port, { path: "/n", headers })).status).toBe(404);
      await daemon.client.notebook.close({ notebook });
      expect((await send("/ping")).status).toBe(404);
    });
  });
});

describe("a path below /n/ that climbs out", () => {
  it("stays out: the endpoint it lands on asks for the token", async () => {
    await withRoutes(async ({ daemon, cell }) => {
      await cell(ping);
      const { port } = daemon.server;
      const status = async (method: string, path: string) =>
        (await rawHttp(port, { method, path })).status;
      expect(await status("POST", "/n/hooks/../../rpc")).toBe(401);
      expect(await status("GET", "/n/hooks/%2e%2e/%2E%2E/schema/settings.json")).toBe(401);
      expect(await status("GET", "/n/hooks/../../ui/hooks")).toBe(401);
      expect(await status("GET", "/n/hooks/..%2F..%2Fschema%2Fsettings.json")).toBe(404);
      expect(await status("GET", "/n/hooks/ping/../ping")).toBe(200);
    });
  });
});

describe("the network rules below /n/", () => {
  it("refuse a foreign Host and a foreign Origin, and let the daemon's own origins and none through", async () => {
    await withRoutes(async ({ daemon, cell, send }) => {
      await cell(ping);
      const port = String(daemon.server.port);
      const status = async (headers: Record<string, string>) =>
        (await send("/ping", { headers })).status;
      expect(await status({ host: `evil.example:${port}` })).toBe(403);
      expect(await status({ host: "127.0.0.1:1" })).toBe(403);
      expect(await status({ origin: "https://evil.example" })).toBe(403);
      expect(await status({ origin: "null" })).toBe(403);
      expect(await status({ origin: `http://127.0.0.1:${port}` })).toBe(200);
      expect(await status({ origin: `http://localhost:${port}`, host: `localhost:${port}` })).toBe(
        200,
      );
      expect(await status({})).toBe(200);
    });
  });
});

describe("the answers below /n/", () => {
  it("carry no CORS header, from a handler that sets them, a preflight route, a 404, a 500 or a 504", async () => {
    await withRoutes(
      async ({ cell, send }) => {
        await cell(`const cors = { "access-control-allow-origin": "*", "access-control-allow-credentials": "true", "Access-Control-Allow-Methods": "POST", "x-kept": "1" };
route("GET /cors", () => new Response("x", { headers: cors }))
route("OPTIONS /cors", () => new Response(null, { status: 204, headers: cors }))
route("GET /boom", () => { throw new Error("boom") })
route("GET /never", () => new Promise(() => {}))`);
        const answers = [
          await send("/cors"),
          await send("/cors", {
            method: "OPTIONS",
            headers: { "access-control-request-method": "POST" },
          }),
          await send("/nope"),
          await send("/boom"),
          await send("/never"),
        ];
        expect(answers.map((answer) => answer.status)).toEqual([200, 204, 404, 500, 504]);
        for (const answer of answers) {
          const names = Object.keys(answer.headers).filter((name) =>
            name.startsWith("access-control-"),
          );
          expect(names).toEqual([]);
        }
        expect(answers[0]?.headers["x-kept"]).toBe("1");
      },
      { routeTimeoutMs: 300 },
    );
  });
});
