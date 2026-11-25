// The route table of 04-kernel §8: route("METHOD /path", handler) registers a handler on the calling cell, replaces
// a registration of the same spec from any cell and returns a disposer; routeUrl(path) is the public URL. Paths are
// compared and printed in core's route form (routePath), so every escaping of a path is one route, and a HEAD
// request a GET route answers when no HEAD route is registered, as HTTP has a server do.
import type { CellId, ExecutionId, Route } from "@jsnb/core";

import { routePath, typeName } from "@jsnb/core";

import { InvalidRouteHandler, InvalidRouteSpec, OutsideCell, unroutableMethods } from "./errors.js";

type Store = { readonly cell: CellId; readonly execution: ExecutionId };
type RouteHandler = (request: Request) => unknown;

/** A registration: the handler, the cell (and the run) that registered it, and its hits. */
type RouteEntry = {
  readonly spec: string;
  readonly method: string;
  readonly path: string;
  readonly cell: CellId;
  readonly execution: ExecutionId;
  readonly registeredAt: string;
  readonly handler: RouteHandler;
  hits: number;
};

export type RouteOptions = {
  /** `http://127.0.0.1:<port>/n/<notebook-name>` (04-kernel §8). */
  readonly routeBase: string;
  readonly currentStore: () => Store | undefined;
  readonly addDisposer: (cell: CellId, fn: () => void) => () => void;
  /** Whether `cell` was deleted and has not run since: its late `route()` registers nothing. */
  readonly retired: (cell: CellId) => boolean;
  /** The current time as an ISO string. */
  readonly now: () => string;
  /** The table changed: a registration, a replacement, a disposal or a hit (routes.changed). */
  readonly onChange: () => void;
};

export type RouteTable = {
  readonly route: (spec: unknown, handler: unknown) => () => void;
  readonly routeUrl: (path: unknown) => string;
  readonly match: (method: string, path: string) => RouteEntry | undefined;
  readonly hit: (entry: RouteEntry) => void;
  readonly list: () => readonly Route[];
};

/** `METHOD /path`; a query or fragment in the path could never be requested, so it is no spec. */
const specPattern = /^\s*([A-Za-z]+)\s+(\/[^\s?#]*)\s*$/;
const isHandler = (value: unknown): value is RouteHandler => typeof value === "function";

/** `path` in route form, or undefined when it has no URL form (a lone surrogate). */
function formOf(path: string): string | undefined {
  try {
    return routePath(path);
  } catch {
    // encodeURIComponent refuses a lone surrogate: no request can name that path.
    return undefined;
  }
}

/** A spec path's route form, or undefined when no request can name it (a `.` or `..` segment, which a URL resolves
 * away, or a character with no URL form). */
function reachableForm(path: string): string | undefined {
  const dotted = path.split("/").some((segment) => segment === "." || segment === "..");
  return dotted ? undefined : formOf(path);
}

/** `"post /hook"` → `{ method: "POST", path: "/hook", key: "POST /hook" }`; anything else throws InvalidRouteSpec. */
function parseSpec(spec: unknown): {
  readonly method: string;
  readonly path: string;
  readonly key: string;
} {
  const match = typeof spec === "string" ? specPattern.exec(spec) : null;
  const [, method, path] = match ?? [];
  const upper = method?.toUpperCase();
  const form = path === undefined ? undefined : reachableForm(path);
  if (
    upper === undefined ||
    path === undefined ||
    form === undefined ||
    unroutableMethods.has(upper)
  )
    throw new InvalidRouteSpec({ spec: String(spec) });
  return { method: upper, path, key: `${upper} ${form}` };
}

/** The public URL of `path`: the route base, then the path in route form; a query or fragment it carries is kept. */
function routeUrl(options: RouteOptions, path: unknown): string {
  const text = String(path);
  const rooted = text.startsWith("/") ? text : `/${text}`;
  const end = rooted.search(/[?#]/);
  const [head, rest] = end < 0 ? [rooted, ""] : [rooted.slice(0, end), rooted.slice(end)];
  return `${options.routeBase}${formOf(head) ?? head}${rest}`;
}

/** An empty route table. */
export function createRoutes(options: RouteOptions): RouteTable {
  const table = new Map<string, RouteEntry>();

  /** `route(spec, handler)`: registers on the current cell, replacing the spec's registration, returns a disposer. */
  const register = (spec: unknown, handler: unknown): (() => void) => {
    const { method, path, key } = parseSpec(spec);
    const written = `${method} ${path}`;
    if (!isHandler(handler))
      throw new InvalidRouteHandler({ spec: written, type: typeName(handler) });
    const store = options.currentStore();
    if (!store) throw new OutsideCell({ builtin: "route" });
    if (options.retired(store.cell)) return () => undefined;
    const registeredAt = options.now();
    const entry: RouteEntry = {
      spec: written,
      method,
      path,
      ...store,
      registeredAt,
      handler,
      hits: 0,
    };
    table.set(key, entry);
    // Disposing a replaced registration must not remove the one that replaced it.
    const dispose = () => {
      if (table.get(key) !== entry) return;
      table.delete(key);
      options.onChange();
    };
    options.addDisposer(store.cell, dispose);
    options.onChange();
    return dispose;
  };

  /** The route `method` and `path` reach: the same method, else for HEAD the GET route; paths compared in route form. */
  const match = (method: string, path: string): RouteEntry | undefined => {
    const form = formOf(path);
    if (form === undefined) return undefined;
    const upper = method.toUpperCase();
    const exact = table.get(`${upper} ${form}`);
    return exact ?? (upper === "HEAD" ? table.get(`GET ${form}`) : undefined);
  };

  return {
    route: register,
    routeUrl: (path) => routeUrl(options, path),
    match,
    hit: (entry) => {
      entry.hits += 1;
      options.onChange();
    },
    list: () =>
      [...table.values()].map(({ spec, method, path, cell, registeredAt, hits }) => {
        const url = routeUrl(options, path);
        return { spec, method, path, url, cell, registeredAt, hits };
      }),
  };
}
