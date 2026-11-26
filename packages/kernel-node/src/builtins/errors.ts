// The errors the kernel child raises: those of the server built-ins beyond core's InvalidDisposer,
// one per mistake a cell can make with them, an unreadable .env, code that is not a compiled cell and a process hook a
// cell replaced with one that does not deliver; each message names the thing and says what to do.
import { JsnbError } from "@jsnb/core";

type Cause = { readonly cause?: unknown };
type Typed = { readonly type: string };

/** "a number", "an object", "null", "undefined": the type as a sentence says it. */
const spoken = (type: string): string =>
  type === "null" || type === "undefined" ? type : `${/^[aeiou]/.test(type) ? "an" : "a"} ${type}`;

type Spec = { readonly spec: string };
/** The methods Fetch refuses to make a Request of, so no handler could receive one. */
export const unroutableMethods: ReadonlySet<string> = new Set(["CONNECT", "TRACE", "TRACK"]);

const invalidRouteSpecMessage = ({ spec }: Spec): string => {
  const method = /^\s*([A-Za-z]+)\s/.exec(spec)?.[1]?.toUpperCase();
  const got = JSON.stringify(spec);
  if (method !== undefined && unroutableMethods.has(method))
    return `route() cannot serve ${method}: Fetch refuses CONNECT, TRACE and TRACK requests; got ${got}.`;
  if (/^\s*[A-Za-z]+\s+\/\S*\s*$/.test(spec))
    return `route()'s path cannot hold "?", "#", a "." or ".." segment or an unpaired surrogate, since no request names such a path; got ${got}. Read the query from req.url instead.`;
  return `route() takes "METHOD /path", such as route("POST /webhook", handler); got ${got}.`;
};

/** `route(spec, …)` with a spec that is not `"METHOD /path"`. */
export class InvalidRouteSpec extends JsnbError {
  declare readonly data: Spec;
  constructor(data: Spec, options: Cause = {}) {
    super({ name: "InvalidRouteSpec", message: invalidRouteSpecMessage(data), data, ...options });
  }
}

type SpecTyped = Spec & Typed;
const invalidRouteHandlerMessage = ({ spec, type }: SpecTyped): string =>
  `route("${spec}", handler) needs a handler function, not ${spoken(type)}. Pass (req) => a Response, an object, a string or nothing.`;

/** `route(spec, handler)` with a handler that is not a function. */
export class InvalidRouteHandler extends JsnbError {
  declare readonly data: SpecTyped;
  constructor(data: SpecTyped, options: Cause = {}) {
    const message = invalidRouteHandlerMessage(data);
    super({ name: "InvalidRouteHandler", message, data, ...options });
  }
}

const routeResultInvalidMessage = ({ spec, type }: SpecTyped): string =>
  type === "Response.error()"
    ? `The handler of ${spec} returned Response.error(), which carries no HTTP status. Return a Response with a status, a string, plain data or nothing.`
    : `The handler of ${spec} returned ${spoken(type)}, which has no JSON form. Return a Response, a string, plain data or nothing.`;

/** A route handler's result that JSON.stringify cannot write (a function, a symbol). */
export class RouteResultInvalid extends JsnbError {
  declare readonly data: SpecTyped;
  constructor(data: SpecTyped, options: Cause = {}) {
    const message = routeResultInvalidMessage(data);
    super({ name: "RouteResultInvalid", message, data, ...options });
  }
}

type Builtin = { readonly builtin: string };
const outsideCellMessage = ({ builtin }: Builtin): string =>
  `${builtin}() was called outside any cell's run, so no cell can own what it registers. Call it from cell code.`;

/** A built-in that registers on the calling cell (route, dispose) called with no cell context. */
export class OutsideCell extends JsnbError {
  declare readonly data: Builtin;
  constructor(data: Builtin, options: Cause = {}) {
    super({ name: "OutsideCell", message: outsideCellMessage(data), data, ...options });
  }
}

type Path = { readonly path: string };
const loaderInvalidMessage = ({ path }: Path): string =>
  `${path} does not export a load function. Restart the kernel to rewrite it.`;

/** The workspace loader without its `load` export. */
export class LoaderInvalid extends JsnbError {
  declare readonly data: Path;
  constructor(data: Path, options: Cause = {}) {
    super({ name: "LoaderInvalid", message: loaderInvalidMessage(data), data, ...options });
  }
}

type Unreadable = Path & { readonly reason: string };
const envUnreadableMessage = ({ path, reason }: Unreadable): string =>
  `${path} could not be read (${reason}), so the run did not start. Make it a regular file the kernel may read, of at most 1 MiB, then run the cell again.`;

/**
 * The workspace .env exists but cannot be read at start or before a run: a permission, or something
 * other than a regular file of at most 1 MiB (a FIFO, a directory), which the kernel refuses without opening it.
 */
export class EnvUnreadable extends JsnbError {
  declare readonly data: Unreadable;
  constructor(data: Unreadable, options: Cause = {}) {
    super({ name: "EnvUnreadable", message: envUnreadableMessage(data), data, ...options });
  }
}

type Cell = { readonly cell: string };
const cellCodeInvalidMessage = ({ cell }: Cell): string =>
  `The code sent for cell ${cell} is not a compiled cell: it does not evaluate to a cell function. Run the cell again, and report it if it happens again.`;

/** An `execute` whose code evaluates to something other than a cell function: a daemon fault. */
export class CellCodeInvalid extends JsnbError {
  declare readonly data: Cell;
  constructor(data: Cell, options: Cause = {}) {
    super({ name: "CellCodeInvalid", message: cellCodeInvalidMessage(data), data, ...options });
  }
}

type Hook = { readonly name: "process.nextTick" | "process.emit" };
const processHookReplacedMessage = ({ name }: Hook): string =>
  `${name} was replaced by a function or an accessor that does not call Node's own, so this kernel stopped receiving runs and requests; it has put Node's own back. Replace ${name} only with a wrapper that calls the original, or fake it only around synchronous code and restore it before the cell awaits anything (with fake timers, uninstall them before its first await).`;

/**
 * A cell replaced process.nextTick or process.emit, through which Node delivers every daemon message, with a function
 * or an accessor that does not deliver: the kernel put Node's own back, and the cell whose code ran
 * last says so.
 */
export class ProcessHookReplaced extends JsnbError {
  declare readonly data: Hook;
  constructor(data: Hook, options: Cause = {}) {
    const message = processHookReplacedMessage(data);
    super({ name: "ProcessHookReplaced", message, data, ...options });
  }
}
