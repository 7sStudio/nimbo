// The routes suite, a handler that fails (04-kernel §8, 03-api §7.1): a throw answers 500
// and is an error output on the route's cell later, its own status staying ok; a result with no JSON form is 500 too;
// a slow handler is waited for, up to the route timeout (504, the kernel answering the next request); requests run side
// by side; a kernel that dies leaves no route (502 for the request under way, 404 after, routes.changed with none). A
// sender that leaves early is senders.integration.
import { describe, expect, it } from "vitest";

import { withRoutes } from "../../../fixtures/routes.js";

describe("a handler that throws", () => {
  it("answers 500 with the error's name and message; the error is a later output of the route's cell, still ok", async () => {
    await withRoutes(async ({ daemon, notebook, cell, send, eventsOn, routes }) => {
      const id = await cell('route("GET /boom", () => { throw new RangeError("nope") })');
      const answer = await send("/boom");
      expect([answer.status, answer.body]).toEqual([500, "RangeError: nope"]);
      expect(answer.headers["content-type"]).toBe("text/plain; charset=utf-8");
      const [event] = await eventsOn(id, 1);
      expect(event).toMatchObject({ kind: "event", name: "GET /boom", data: { status: 500 } });
      const { execution } = await daemon.client.cell.outputs({ notebook, cell: id });
      expect(execution?.status).toBe("ok");
      const errors = execution?.outputs.flatMap((output) =>
        output.kind === "error" ? [[output.error.name, output.error.message]] : [],
      );
      expect(errors).toEqual([["RangeError", "nope"]]);
      expect((await routes())[0]?.hits).toBe(1);
    });
  });

  it("answers 500 for an async rejection and for a result that has no JSON form", async () => {
    await withRoutes(async ({ cell, send }) => {
      await cell(`route("POST /later", async () => { await null; throw new Error("later") })
route("GET /fn", () => () => 1)
route("GET /big", () => ({ n: 1n }))
route("GET /error", () => Response.error())`);
      expect([(await send("/later", { method: "POST" })).body]).toEqual(["Error: later"]);
      const fn = await send("/fn");
      expect([fn.status, fn.body.startsWith("RouteResultInvalid: ")]).toEqual([500, true]);
      const big = await send("/big");
      expect([big.status, big.body.startsWith("TypeError: ")]).toEqual([500, true]);
      const error = await send("/error");
      expect([
        error.status,
        error.body.includes("Response.error(), which carries no HTTP status"),
      ]).toEqual([500, true]);
    });
  });
});

describe("a slow handler", () => {
  it("is waited for, and two requests run side by side", async () => {
    await withRoutes(async ({ cell, send }) => {
      await cell(`let opened = 0;
let release = () => {};
const both = new Promise((resolve) => { release = resolve; });
route("GET /slow", async () => {
  opened += 1;
  if (opened === 2) release();
  await both;
  return "after " + String(opened);
})`);
      const answers = await Promise.all([send("/slow"), send("/slow")]);
      expect(answers.map(({ status, body }) => [status, body])).toEqual([
        [200, "after 2"],
        [200, "after 2"],
      ]);
    });
  });

  it("answers 504 past the route timeout, and the kernel answers the next request", async () => {
    await withRoutes(
      async ({ cell, send, routes }) => {
        await cell(`route("GET /never", () => new Promise(() => {}))
route("GET /ok", () => "ok")`);
        const late = await send("/never");
        expect(late.status).toBe(504);
        expect(late.body).toBe(
          "The kernel did not answer the route request within 0.3s. The kernel may be busy; try kernel.interrupt.",
        );
        expect(late.headers["access-control-allow-origin"]).toBeUndefined();
        expect([(await send("/ok")).status, (await send("/ok")).body]).toEqual([200, "ok"]);
        expect((await routes()).map(({ spec, hits }) => [spec, hits])).toEqual([
          ["GET /never", 0],
          ["GET /ok", 2],
        ]);
      },
      { routeTimeoutMs: 300 },
    );
  });
});

describe("a kernel that dies", () => {
  it("answers 502 to the request under way, then 404: kernel.routes is empty and routes.changed says so", async () => {
    await withRoutes(async ({ daemon, notebook, cell, send, routes, changed, eventsOn }) => {
      const id =
        await cell(`route("GET /hang", () => { console.log("in"); return new Promise(() => {}) })
route("GET /ping", () => "pong")`);
      await changed((list) => list.length === 2);
      const { pid } = await daemon.client.kernel.status({ notebook });
      const pending = send("/hang");
      await daemon.events.until(
        "cell.output",
        (e) => e.data.cell === id && e.data.output.kind === "stream",
      );
      if (pid === null) throw new Error("the kernel reported no pid");
      process.kill(pid, "SIGKILL");
      const answer = await pending;
      expect([answer.status, answer.body]).toEqual([
        502,
        "The notebook's kernel could not answer this request. The details are in the daemon's log.",
      ]);
      await daemon.events.until("kernel.status", (e) => e.data.state === "dead");
      await changed((list) => list.length === 0);
      expect(await routes()).toEqual([]);
      const gone = await send("/ping");
      expect([gone.status, gone.body]).toEqual([404, "No route at /n/hooks/ping."]);
      expect(await eventsOn(id, 0)).toEqual([]);
    });
  });
});
