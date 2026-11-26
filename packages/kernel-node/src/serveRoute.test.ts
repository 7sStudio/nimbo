// Tests a forwarded route request: raw and JSON bodies, every result shape, 404, a throwing handler,
// replacement, hits and the event output on the route's cell.
import type { RouteResponse } from "@jsnb/core";
import { compileCell } from "@jsnb/test-tools/kernel";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Harness } from "./fixtures/realmHarness.js";
import { cellBook, createHarness, warmUp } from "./fixtures/realmHarness.js";
import { routeFlow } from "./serveRoute.js";

const book = cellBook({
  routes: [
    "route('POST /raw', async (req) => 'raw:' + await req.text())",
    "route('POST /json', async (req) => ({ got: (await req.json()).type }))",
    "route('GET /response', () => new Response('nope', { status: 401, headers: { 'x-a': '1' } }))",
    "route('GET /empty', () => {})",
    "route('GET /boom', () => { throw new Error('handler failed') })",
  ].join("\n"),
  replacing: "route('GET /empty', () => 'replaced')",
  slow: "route('GET /slow', () => new Promise((resolve) => setTimeout(() => resolve('late'), 30)))",
});

beforeAll(async () => {
  book.compile(compileCell);
  await warmUp(compileCell);
});

let harness: Harness;
afterEach(() => {
  harness.close();
});

const b64 = (text: string) => Buffer.from(text).toString("base64");
const text = (response: RouteResponse) => Buffer.from(response.body, "base64").toString("utf8");
let ids = 0;

async function send(
  method: string,
  path: string,
  body = "",
  headers: Record<string, string> = {},
): Promise<RouteResponse> {
  ids += 1;
  await routeFlow(harness.realm, {
    type: "route",
    id: ids,
    method,
    path,
    search: "",
    headers,
    rawBody: b64(body),
  });
  return (harness.result(ids) as { value: RouteResponse }).value;
}

describe("routeFlow answers", () => {
  it("hands the raw body and the JSON body to the handler and answers text, JSON, a Response and 204", async () => {
    harness = createHarness();
    await harness.run(book.cell("routes"));
    expect(text(await send("POST", "/raw", "a=1&b=2"))).toBe("raw:a=1&b=2");
    const json = await send("POST", "/json", '{"type":"evt"}');
    expect([json.status, json.headers, text(json)]).toEqual([
      200,
      { "content-type": "application/json" },
      '{"got":"evt"}',
    ]);
    const response = await send("GET", "/response");
    expect([response.status, response.headers["x-a"], text(response)]).toEqual([401, "1", "nope"]);
    expect(await send("GET", "/empty")).toEqual({ status: 204, headers: {}, body: "" });
  });

  it("answers 404 for a request no route matches", async () => {
    harness = createHarness();
    const missing = await send("get", "/nothing");
    expect([missing.status, text(missing)]).toEqual([404, "No route for GET /nothing"]);
  });

  it("answers 500 for a throwing handler and reports the error on the route's cell", async () => {
    harness = createHarness();
    const cell = book.cell("routes");
    await harness.run(cell);
    const failed = await send("GET", "/boom");
    expect([failed.status, text(failed)]).toEqual([500, "Error: handler failed"]);
    const error = await harness.until((m) => m.type === "output" && m.output.kind === "error");
    expect(error).toMatchObject({
      execution: cell.execution,
      output: { error: { message: "handler failed" } },
    });
  });
});

describe("routeFlow bookkeeping", () => {
  it("emits an event per request with the status, the body's type, the time and the sender, and counts hits", async () => {
    harness = createHarness();
    const cell = book.cell("routes");
    await harness.run(cell);
    const agent = { "User-Agent": "Stripe/1.0 (+https://stripe.com/docs/webhooks)" };
    await send("POST", "/json", '{"type":"payment_intent.succeeded"}', agent);
    const event = await harness.until((m) => m.type === "output" && m.output.kind === "event");
    expect(event).toEqual({
      type: "output",
      execution: cell.execution,
      output: {
        kind: "event",
        name: "POST /json",
        data: {
          status: 200,
          type: "payment_intent.succeeded",
          durationMs: expect.any(Number) as unknown,
          from: "Stripe",
        },
        at: "2026-10-12T00:00:00.000Z",
      },
    });
    const routes = harness.messages.filter((m) => m.type === "routes").at(-1);
    expect(routes?.type === "routes" && routes.routes.find((r) => r.path === "/json")?.hits).toBe(
      1,
    );
  });
});

describe("routeFlow's request events", () => {
  it("time the handler, and name no sender when the request has no User-Agent", async () => {
    harness = createHarness();
    const cell = book.cell("slow");
    await harness.run(cell);
    await send("GET", "/slow", "", { "user-agent": "curl/8.7.1" });
    await send("GET", "/slow");
    const events = harness.messages.flatMap((m) =>
      m.type === "output" && m.output.kind === "event" ? [m.output.data] : [],
    );
    expect(events).toEqual([
      { status: 200, durationMs: expect.any(Number) as unknown, from: "curl" },
      { status: 200, durationMs: expect.any(Number) as unknown },
    ]);
    // the handler waits 30 ms: the time is the handler's, never less (a lower bound only, no flake)
    for (const data of events)
      expect(Reflect.get(data as object, "durationMs")).toBeGreaterThanOrEqual(25);
  });
});

describe("routeFlow and a re-registered spec", () => {
  it("serves a re-registered spec from its new cell, once", async () => {
    harness = createHarness();
    await harness.run(book.cell("routes"));
    const replacing = book.cell("replacing");
    await harness.run(replacing);
    expect(text(await send("GET", "/empty"))).toBe("replaced");
    expect(harness.realm.routes.list().filter((r) => r.path === "/empty")).toHaveLength(1);
    const events = harness.messages.filter((m) => m.type === "output" && m.output.kind === "event");
    expect(events.map((m) => m.type === "output" && m.execution)).toEqual([replacing.execution]);
  });
});
