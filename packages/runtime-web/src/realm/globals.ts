// A run's `window` and `document` views: its wrapped timers and listeners, the rest of the real objects.
// Every self-reference answers a view (`window.self`, `window.top` in the top page, `document.defaultView`); objects
// reached through a node or an event are the real ones, and packages keep the real globals.
import type { Callable } from "./guard.js";
import { isCallable } from "./guard.js";

export type GlobalViews = {
  readonly window: Window & typeof globalThis;
  readonly document: Document;
};

/** The run's own members of each view: its wrapped timers and window listeners, its document listeners. */
export type ViewMembers = {
  readonly window: Readonly<Record<string, unknown>>;
  readonly document: Readonly<Record<string, unknown>>;
};

type Found = { readonly value: unknown } | undefined;

const boundCache = new WeakMap<object, Map<PropertyKey, { source: unknown; bound: unknown }>>();

/** A method (a function with no own `prototype`, such as `fetch` or `querySelector`) bound to its real target. */
function bound(target: object, key: PropertyKey, method: Callable): unknown {
  const byKey =
    boundCache.get(target) ?? new Map<PropertyKey, { source: unknown; bound: unknown }>();
  boundCache.set(target, byKey);
  const cached = byKey.get(key);
  if (cached?.source === method) return cached.bound;
  const fresh = method.bind(target);
  byKey.set(key, { source: method, bound: fresh });
  return fresh;
}

const isMethod = (value: unknown): value is Callable =>
  isCallable(value) && !Object.hasOwn(value, "prototype");

/** A Proxy over `target`: `own` first, methods bound so `document.querySelector === document.querySelector`. */
function view<T extends object>(target: T, own: (key: string) => Found): T {
  return new Proxy(target, {
    get(real, key) {
      const found = typeof key === "string" ? own(key) : undefined;
      if (found) return found.value;
      const value: unknown = Reflect.get(real, key);
      return isMethod(value) ? bound(real, key, value) : value;
    },
    // The real target is the receiver, so a setter such as `document.title = "x"` works.
    set: (real, key, value) => Reflect.set(real, key, value),
  });
}

/** Names whose value is the window itself. */
const selfNames = new Set(["window", "self", "globalThis", "frames"]);
/** Names whose value is the window itself in a top-level page and another window in a frame. */
const sameWindowNames = new Set(["top", "parent", "opener"]);

const member = (members: Readonly<Record<string, unknown>>, key: string): Found =>
  Object.hasOwn(members, key) ? { value: members[key] } : undefined;

export function createGlobalViews(members: ViewMembers): GlobalViews {
  const windowOwn = (key: string): Found => {
    if (key === "document") return { value: documentView };
    const isSelf =
      selfNames.has(key) || (sameWindowNames.has(key) && Reflect.get(window, key) === window);
    return isSelf ? { value: windowView } : member(members.window, key);
  };
  const documentOwn = (key: string): Found =>
    key === "defaultView" ? { value: windowView } : member(members.document, key);
  const windowView = view(window, windowOwn);
  const documentView = view(document, documentOwn);
  return { window: windowView, document: documentView };
}
