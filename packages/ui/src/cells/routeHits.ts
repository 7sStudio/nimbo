// A route cell's result: the requests each of its listening routes answered, from the event
// outputs the kernel attributes to the cell (`POST /webhook` with `{ status, type }`), and never the
// disposer `route()` returns, which is the cell's last value but means nothing to read.
import type { Output, Route } from "@jsnb/core";

type EventOutput = Extract<Output, { readonly kind: "event" }>;

/** One request a route answered: when, its HTTP status, how long its handler took (the kernel's measure, null from a
 * kernel that does not time it) and the event type its body named, if any. */
type RouteHit = {
  readonly at: string;
  readonly status: number | null;
  readonly ms: number | null;
  readonly type: string;
};

/** A listening route with the requests the cell's outputs hold for it. */
export type RouteHits = { readonly route: Route; readonly hits: readonly RouteHit[] };

const field = (data: unknown, key: string): unknown =>
  typeof data === "object" && data !== null ? Reflect.get(data, key) : undefined;

const hitOf = (event: EventOutput): RouteHit => {
  const status = field(event.data, "status");
  const type = field(event.data, "type");
  const ms = field(event.data, "durationMs");
  return {
    at: event.at,
    status: typeof status === "number" ? status : null,
    ms: typeof ms === "number" ? ms : null,
    type: typeof type === "string" ? type : "",
  };
};

/** The cell's routes with their requests, and the events that belong to none of them (an `on()` listener's, or a
 * route's that no longer listens), which the activity list keeps. */
export function routeHits(
  routes: readonly Route[],
  events: readonly EventOutput[],
): { readonly routes: readonly RouteHits[]; readonly rest: readonly EventOutput[] } {
  const nameOf = (route: Route) => `${route.method} ${route.path}`;
  const names = new Set(routes.map(nameOf));
  return {
    routes: routes.map((route) => ({
      route,
      hits: events.filter((event) => event.name === nameOf(route)).map(hitOf),
    })),
    rest: events.filter((event) => !names.has(event.name)),
  };
}

/** Whether `output` is the disposer a `route(...)` or `on(...)` call returns, the last value of a cell that registers a
 * route or a listener. */
export function isRouteDisposer(output: Output, source: string): boolean {
  if (output.kind !== "value" || field(output.json, "$type") !== "function") return false;
  return field(output.json, "name") === "dispose" && /\b(?:route|on)\s*\(/u.test(source);
}
