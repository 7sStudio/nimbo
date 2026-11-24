// Tests the route table of 04-kernel §8: spec parsing, registration on the cell, replacement, disposal, hits, URLs.
import { describe, expect, it } from "vitest";

import { createDisposers } from "./disposers.js";
import { InvalidRouteHandler, InvalidRouteSpec, OutsideCell } from "./errors.js";
import { createRoutes } from "./routes.js";

type Store = { readonly cell: string; readonly execution: string };
const first: Store = { cell: "c_aaaaaa", execution: "x_aaaaaaaa" };
const second: Store = { cell: "c_bbbbbb", execution: "x_bbbbbbbb" };

function harness() {
  const disposers = createDisposers();
  let current: Store | undefined = first;
  let changes = 0;
  const routes = createRoutes({
    routeBase: "http://127.0.0.1:4321/n/demo",
    currentStore: () => current,
    addDisposer: disposers.add,
    retired: disposers.retired,
    now: () => "2026-10-12T00:00:00.000Z",
    onChange: () => (changes += 1),
  });
  const as = (store: Store | undefined) => (current = store);
  return { routes, disposers, as, changes: () => changes };
}

describe("createRoutes registration", () => {
  it("registers a normalised spec on the current cell and lists it with its URL", () => {
    const { routes, changes } = harness();
    routes.route("post  /hook ", () => "ok");
    expect(routes.list()).toEqual([
      {
        spec: "POST /hook",
        method: "POST",
        path: "/hook",
        url: "http://127.0.0.1:4321/n/demo/hook",
        cell: "c_aaaaaa",
        registeredAt: "2026-10-12T00:00:00.000Z",
        hits: 0,
      },
    ]);
    expect(changes()).toBe(1);
  });

  it("refuses a malformed spec, a missing handler and a call outside any cell", () => {
    const { routes, as } = harness();
    for (const spec of ["webhook", "POST hook", 42, "GET /a?b=1", "GET /a#b", "GET /\uD800"]) {
      expect(() => routes.route(spec, () => 1)).toThrow(InvalidRouteSpec);
    }
    expect(() => routes.route("trace /x", () => 1)).toThrow(/route\(\) cannot serve TRACE/u);
    for (const spec of ["GET /a/../b", "GET /./x", "GET /a?b=1"])
      expect(() => routes.route(spec, () => 1)).toThrow(/no request names such a path/u);
    expect(() => routes.route("GET /x", undefined)).toThrow(InvalidRouteHandler);
    as(undefined);
    expect(() => routes.route("GET /x", () => 1)).toThrow(OutsideCell);
  });
});

describe("createRoutes URLs", () => {
  it("builds URLs below the route base in route form, adding a missing slash and keeping a query", () => {
    const { routes } = harness();
    expect([
      routes.routeUrl("/a"),
      routes.routeUrl("b"),
      routes.routeUrl("/café"),
      routes.routeUrl("/return?session_id={ID}#top"),
    ]).toEqual([
      "http://127.0.0.1:4321/n/demo/a",
      "http://127.0.0.1:4321/n/demo/b",
      "http://127.0.0.1:4321/n/demo/caf%C3%A9",
      "http://127.0.0.1:4321/n/demo/return?session_id={ID}#top",
    ]);
  });
});

describe("createRoutes on a deleted cell", () => {
  it("registers nothing from a retired cell, until the cell runs again", async () => {
    const { routes, disposers, changes } = harness();
    routes.route("GET /a", () => 1);
    await disposers.retire("c_aaaaaa");
    expect([routes.list(), changes()]).toEqual([[], 2]);
    const late = routes.route("GET /late", () => 2);
    late();
    expect([routes.list(), changes()]).toEqual([[], 2]);
    disposers.revive("c_aaaaaa");
    routes.route("GET /back", () => 3);
    expect(routes.list().map((route) => route.spec)).toEqual(["GET /back"]);
  });
});

describe("createRoutes paths", () => {
  it("lists a path as written with its URL in route form, one route for every escaping of it", () => {
    const { routes } = harness();
    routes.route("GET /café", () => 1);
    routes.route("GET /caf%c3%a9", () => 2);
    expect(routes.list()).toMatchObject([
      { spec: "GET /caf%c3%a9", path: "/caf%c3%a9", url: "http://127.0.0.1:4321/n/demo/caf%C3%A9" },
    ]);
    expect(routes.match("GET", "/caf%C3%A9")?.spec).toBe("GET /caf%c3%a9");
  });
});

describe("createRoutes replacement and disposal", () => {
  it("replaces a registration of the same spec from another cell, and the old disposer leaves it alone", async () => {
    const { routes, disposers, as } = harness();
    const old = routes.route("GET /x", () => "old");
    as(second);
    routes.route("get /x", () => "new");
    old();
    await disposers.run("c_aaaaaa");
    expect(routes.list().map(({ cell }) => cell)).toEqual(["c_bbbbbb"]);
    expect(routes.match("GET", "/x")?.cell).toBe("c_bbbbbb");
  });

  it("removes a route through its disposer or its cell's disposers, once", async () => {
    const { routes, disposers, changes } = harness();
    const dispose = routes.route("GET /a", () => 1);
    routes.route("GET /b", () => 1);
    dispose();
    dispose();
    await disposers.run("c_aaaaaa");
    expect(routes.list()).toEqual([]);
    expect(changes()).toBe(4);
  });

  it("matches method and path, a HEAD by the GET route unless one is its own, and counts hits", () => {
    const { routes, changes } = harness();
    routes.route("GET /a", () => 1);
    const entry = routes.match("get", "/a");
    expect(entry?.execution).toBe("x_aaaaaaaa");
    expect(routes.match("GET", "/a/")).toBeUndefined();
    expect(routes.match("POST", "/a")).toBeUndefined();
    expect(routes.match("HEAD", "/a")).toBe(entry);
    routes.route("HEAD /a", () => 2);
    expect(routes.match("HEAD", "/a")?.spec).toBe("HEAD /a");
    expect(routes.match("HEAD", "/b")).toBeUndefined();
    if (entry) routes.hit(entry);
    expect(routes.list()[0]?.hits).toBe(1);
    expect(changes()).toBe(3);
  });
});
