// A route cell's result: each listening route with the requests the cell's event outputs hold for it, the events no
// route claims kept for the activity list, and the disposer route() returns never shown.
import type { Output, Route } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { isRouteDisposer, routeHits } from "./routeHits.js";

const route = (method: string, path: string, hits = 0): Route => ({
  spec: `${method} ${path}`,
  method,
  path,
  url: `http://127.0.0.1:4000/n/demo${path}`,
  cell: "c_aaaaaa",
  registeredAt: "2026-11-14T14:00:00.000Z",
  hits,
});
const event = (name: string, data: unknown, at = "2026-11-14T14:01:24.000Z") =>
  ({ kind: "event", name, data, at }) as const;

describe("routeHits", () => {
  it("gives each route its requests in order, with status, time and event type, and keeps the rest", () => {
    const webhook = route("POST", "/webhook", 2);
    const ping = route("GET", "/ping", 1);
    const { routes, rest } = routeHits(
      [webhook, ping],
      [
        event("POST /webhook", { status: 200, type: "payment_intent.created", durationMs: 12.4 }),
        event("GET /ping", { status: 200 }),
        event("tick", 1),
        event("POST /webhook", { status: 500 }, "2026-11-14T14:01:31.000Z"),
        event("POST /webhook", "not an object"),
      ],
    );
    expect(routes.map((each) => [each.route.spec, each.hits])).toEqual([
      [
        "POST /webhook",
        [
          { at: "2026-11-14T14:01:24.000Z", status: 200, ms: 12.4, type: "payment_intent.created" },
          { at: "2026-11-14T14:01:31.000Z", status: 500, ms: null, type: "" },
          { at: "2026-11-14T14:01:24.000Z", status: null, ms: null, type: "" },
        ],
      ],
      ["GET /ping", [{ at: "2026-11-14T14:01:24.000Z", status: 200, ms: null, type: "" }]],
    ]);
    expect(rest).toEqual([event("tick", 1)]);
  });

  it("keeps every event for the activity list when no route listens", () => {
    const events = [event("POST /gone", { status: 200 })];
    expect(routeHits([], events)).toEqual({ routes: [], rest: events });
  });
});

describe("isRouteDisposer", () => {
  const disposer: Output = {
    kind: "value",
    json: { $type: "function", name: "dispose" },
    repr: "[Function: dispose]",
    truncated: false,
  };
  it("is the disposer a cell that calls route() ends with, and nothing else", () => {
    const source = 'route("POST /webhook", async () => ({ ok: true }));';
    expect(isRouteDisposer(disposer, source)).toBe(true);
    expect(isRouteDisposer(disposer, "const dispose = () => 1;\ndispose")).toBe(false);
    const named = { ...disposer, json: { $type: "function", name: "createIntent" } };
    expect(isRouteDisposer(named, source)).toBe(false);
    expect(isRouteDisposer({ ...disposer, json: "dispose" }, source)).toBe(false);
    expect(isRouteDisposer({ kind: "stream", stream: "stdout", text: "x" }, source)).toBe(false);
  });
});
