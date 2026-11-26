// The routes suite, what the daemon says of the routes (03-api §4.4 kernel.routes, §5 Route, §6 routes.changed; 04-kernel
// §5.6, §8): each route's spec, method, path, URL (routeUrl's, exactly), cell, registeredAt and hits; routes.changed on
// a registration, a replacement, a disposal and a hit, with a growing seq; hits for every answered request, not a 404;
// an `event` output per hit on the registering cell's latest run; names and paths that need escaping in a URL.
import type { Route } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { valueOf } from "../../../fixtures/notebook.js";
import { rawHttp } from "../../../fixtures/raw.js";
import { withRoutes } from "../../../fixtures/routes.js";

const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

describe("kernel.routes", () => {
  it("lists each route with its spec, method, path, routeUrl's URL, its cell, registeredAt and hits", async () => {
    await withRoutes(async ({ daemon, book, routes }) => {
      const { cell, execution } = await book.ran(`route("POST /webhook", () => ({}))
route("get /ping", () => "pong")
routeUrl("/webhook")`);
      const port = String(daemon.server.port);
      const url = `http://127.0.0.1:${port}/n/hooks/webhook`;
      expect(valueOf(execution)).toBe(url);
      const listed = await routes();
      for (const route of listed) expect(route.registeredAt).toMatch(iso);
      expect(listed.map((route) => ({ ...route, registeredAt: "" }))).toEqual([
        {
          spec: "POST /webhook",
          method: "POST",
          path: "/webhook",
          url,
          cell,
          hits: 0,
          registeredAt: "",
        },
        {
          spec: "GET /ping",
          method: "GET",
          path: "/ping",
          url: `http://127.0.0.1:${port}/n/hooks/ping`,
          cell,
          hits: 0,
          registeredAt: "",
        },
      ]);
      const ping = await fetch(listed[1]?.url ?? "");
      expect(await ping.text()).toBe("pong");
    });
  });
});

describe("routes.changed", () => {
  it("follows a registration, a hit, a replacement and a disposal, each with a greater seq", async () => {
    await withRoutes(async ({ daemon, notebook, cell, rerun, send, changes, changed }) => {
      const first = await cell('route("GET /a", () => 1)');
      await send("/a");
      await changed((list) => list[0]?.hits === 1);
      const second = await cell('route("GET /a", () => 2)');
      await changed((list) => list[0]?.cell === second);
      await daemon.client.cell.update({ notebook, cell: second, source: "2" });
      await rerun(second);
      await changed((list) => list.length === 0);
      const seen = changes();
      const shapes = seen.map(({ data }) =>
        data.routes.map(
          (route: Route) => `${route.cell === first ? "first" : "second"}:${String(route.hits)}`,
        ),
      );
      expect(shapes).toEqual([["first:0"], ["first:1"], ["second:0"], []]);
      const seqs = seen.map((event) => event.seq);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      expect(new Set(seqs).size).toBe(seqs.length);
      expect(seen.every((event) => event.notebook === notebook)).toBe(true);
    });
  });
});

describe("hits and events", () => {
  it("count every answered request, a 500 included, and never a 404; each is an event on the route's cell", async () => {
    await withRoutes(async ({ cell, send, routes, eventsOn }) => {
      const id = await cell(
        `route("POST /webhook", async (req) => { const body = await req.json(); if (body.fail) throw new Error("no"); return { ok: true } })`,
      );
      const post = (body: string) => send("/webhook", { method: "POST", body });
      expect((await post('{"type":"payment_intent.succeeded"}')).status).toBe(200);
      expect((await post('{"type":"charge.failed","fail":true}')).status).toBe(500);
      expect((await post("plain text")).status).toBe(500);
      expect((await send("/nope", { method: "POST" })).status).toBe(404);
      expect((await send("/webhook")).status).toBe(404);
      expect((await routes())[0]?.hits).toBe(3);
      const events = await eventsOn(id, 3);
      // each with the time its handler took (04-kernel §5.6); a sender with no User-Agent is named by none
      const took = expect.any(Number) as unknown;
      expect(events.map(({ name, data }) => [name, data])).toEqual([
        ["POST /webhook", { status: 200, type: "payment_intent.succeeded", durationMs: took }],
        ["POST /webhook", { status: 500, type: "charge.failed", durationMs: took }],
        ["POST /webhook", { status: 500, durationMs: took }],
      ]);
      for (const event of events) expect(event.at).toMatch(iso);
    });
  });
});

describe("an event output", () => {
  it("carries a body's type cut to a short label, whatever length the sender chose", async () => {
    await withRoutes(async ({ cell, send, eventsOn }) => {
      const id = await cell('route("POST /hook", () => "ok")');
      const type = "x".repeat(100_000);
      expect((await send("/hook", { method: "POST", body: JSON.stringify({ type }) })).body).toBe(
        "ok",
      );
      const [event] = await eventsOn(id, 1);
      expect(event?.data).toEqual({
        status: 200,
        type: `${"x".repeat(199)}…`,
        durationMs: expect.any(Number) as unknown,
      });
    });
  });

  it("lands on the cell's latest run, in cell.outputs as well as in events", async () => {
    await withRoutes(async ({ daemon, notebook, cell, rerun, send, eventsOn }) => {
      const id = await cell('const n = 1\nroute("GET /e", () => "e")');
      const latest = await rerun(id);
      await send("/e");
      await eventsOn(id, 1);
      const { execution } = await daemon.client.cell.outputs({ notebook, cell: id });
      expect(execution?.id).toBe(latest.id);
      expect(execution?.outputs.filter((output) => output.kind === "event")).toMatchObject([
        { kind: "event", name: "GET /e", data: { status: 200 } },
      ]);
    });
  });
});

describe("a notebook name and a path that need escaping", () => {
  it("are served in every escaping of them; routeUrl and Route.url give the escaped form", async () => {
    await withRoutes(
      async ({ daemon, book, routes }) => {
        const { execution } = await book.ran('route("GET /café", () => "c")\nrouteUrl("/café")');
        const port = daemon.server.port;
        const url = `http://127.0.0.1:${String(port)}/n/My%20Notes/caf%C3%A9%2C%201/caf%C3%A9`;
        expect(valueOf(execution)).toBe(url);
        expect((await routes())[0]).toMatchObject({ spec: "GET /café", path: "/café", url });
        expect(await (await fetch(url)).text()).toBe("c");
        for (const path of [
          "/n/My%20Notes/caf%c3%a9%2c%201/caf%c3%a9",
          "/n/My%20Notes/caf%C3%A9,%201/caf%C3%A9",
        ]) {
          expect([path, (await rawHttp(port, { path })).body]).toEqual([path, "c"]);
        }
        const encodedSlash = "/n/My%20Notes%2Fcaf%C3%A9%2C%201/caf%C3%A9";
        expect((await rawHttp(port, { path: encodedSlash })).status).toBe(404);
      },
      { notebook: "My Notes/café, 1.jsnb" },
    );
  });
});
