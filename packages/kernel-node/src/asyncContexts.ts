// The async context the code running now is in, as the interrupt hook reads it (04-kernel §6). Node pushes some
// contexts onto its async-id stack from JavaScript (a Timeout's or an Immediate's callback, process.nextTick's
// TickObject, an AsyncResource scope, queueMicrotask's under a store, a Promise under promise hooks or in its
// unhandled-rejection processing) and pops them in code a termination skips, so a termination there corrupts Node's
// async stack: the kernel ends at once, or aborts the first time any async hook is enabled later. Contexts Node enters
// natively (libuv callbacks) pop in C++, and promise jobs push nothing, so those are clean. Only the innermost context
// is read, and only through intrinsics and prototypes captured when the module loads: the resource's prototype chain is
// walked by identity, never through a Proxy, whose traps would be a cell's code run inside the hook. A Proxy can only
// have been pushed through AsyncResource.prototype.runInAsyncScope, so a resource that is one, or has one on its
// chain, is an AsyncResource scope.
import { AsyncResource, executionAsyncId, executionAsyncResource } from "node:async_hooks";
import { types } from "node:util";

import type { InterruptContext } from "@jsnb/core";

const { getPrototypeOf } = Reflect;
const { isProxy } = types;
const objectPrototype: object = Object.prototype;

/** The prototype of the handle `make` returns, cleared at once. */
function handlePrototype<H extends object>(
  make: () => H,
  clear: (handle: H) => void,
): object | null {
  const handle = make();
  clear(handle);
  return getPrototypeOf(handle);
}

/** The prototypes of the resources Node pushes from JavaScript, with the context each one is. */
const pushedPrototypes: readonly (readonly [object | null, InterruptContext])[] = [
  [handlePrototype(() => setTimeout(() => undefined, 0), clearTimeout), "Timeout"],
  [handlePrototype(() => setImmediate(() => undefined), clearImmediate), "Immediate"],
  [AsyncResource.prototype, "AsyncResource"],
  [Promise.prototype, "Promise"],
];

/** The most prototypes walked: a real chain is a handful deep, and V8 allows no cycle. */
const maxDepth = 64;

/** The context a prototype on a resource's chain stands for, if it is one Node pushes from JavaScript. */
function contextOfPrototype(prototype: object): InterruptContext | undefined {
  for (const [pushed, context] of pushedPrototypes) if (pushed === prototype) return context;
  return undefined;
}

/**
 * The context of an async resource Node pushed from JavaScript; undefined for one it entered natively. The chain is read
 * one prototype at a time, stopping at a Proxy (an AsyncResource scope entered through one) before touching it.
 */
export function contextOf(resource: unknown): InterruptContext | undefined {
  if (typeof resource !== "object" || resource === null) return undefined;
  let holder: object = resource;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (isProxy(holder)) return "AsyncResource";
    const prototype: object | null = getPrototypeOf(holder);
    if (prototype === null) return undefined;
    const context = contextOfPrototype(prototype);
    if (context !== undefined) return context;
    if (prototype === objectPrototype) return holder === resource ? "TickObject" : undefined;
    holder = prototype;
  }
  return undefined;
}

/**
 * The context Node entered from JavaScript that the code running now is in, by its innermost async resource; undefined
 * for the top level (id 0: promise jobs, the kernel's own work), whose resource is never read (the first read sets a
 * flag in Node), and for contexts Node enters natively. A plain object with a non-zero id is a TickObject.
 */
export function pushedContext(): InterruptContext | undefined {
  return executionAsyncId() === 0 ? undefined : contextOf(executionAsyncResource());
}
