// Properties a cell may have made accessors or put behind a Proxy, as the kernel reads and writes them in its own
// checks (04-kernel §3.3, §6): through their descriptors only, with intrinsics captured when the module loads, so no
// getter, setter or Proxy trap of a cell's runs inside the kernel's own code or its interrupt hook. The descriptors the
// kernel defines have no prototype, so a cell's `Object.prototype.get` or `.value` cannot turn one into another.
import { types } from "node:util";

const { getOwnPropertyDescriptor, getPrototypeOf, setPrototypeOf } = Reflect;
const { hasOwn } = Object;
const { isProxy } = types;

/** What reading a property would find, by its descriptor along the prototype chain, without reading it. */
export type Found =
  | { readonly kind: "data"; readonly value: unknown }
  | { readonly kind: "accessor"; readonly get: unknown }
  | { readonly kind: "proxy"; readonly proxy: object }
  | { readonly kind: "absent" };

/** The most prototypes walked: a real chain is a handful deep, and V8 allows no cycle. */
const maxDepth = 64;

/** A descriptor of the kernel's own, made prototype-free in place. */
export function bare(descriptor: PropertyDescriptor): PropertyDescriptor {
  setPrototypeOf(descriptor, null);
  return descriptor;
}

/** The own descriptor of `key` on `target` (no Proxy), prototype-free; undefined when there is none. */
export function ownDescriptor(target: object, key: PropertyKey): PropertyDescriptor | undefined {
  const own = getOwnPropertyDescriptor(target, key);
  return own && bare(own);
}

/** True for an accessor descriptor (its own `get` and `set` keys), false for a data one or none. */
export const isAccessor = (descriptor: PropertyDescriptor | undefined): boolean =>
  descriptor !== undefined && hasOwn(descriptor, "get");

/**
 * What reading `key` on `target` would find: the first own descriptor along its prototype chain, never calling a getter
 * and stopping at a Proxy, whose traps only a read through it runs; absent past the end of the chain.
 */
export function findProperty(target: object, key: PropertyKey): Found {
  let holder: object | null = target;
  for (let depth = 0; holder !== null && depth < maxDepth; depth += 1) {
    if (isProxy(holder)) return { kind: "proxy", proxy: holder };
    const own = getOwnPropertyDescriptor(holder, key);
    if (own !== undefined)
      return hasOwn(own, "get")
        ? { kind: "accessor", get: own.get }
        : { kind: "data", value: own.value };
    holder = getPrototypeOf(holder);
  }
  return { kind: "absent" };
}

/** True when reading `key` on `target` would find exactly `value` in a data property. */
export function holdsValue(target: object, key: PropertyKey, value: unknown): boolean {
  const found = findProperty(target, key);
  return found.kind === "data" && found.value === value;
}

/** True when two finds name the same thing: the same value, the same getter, the same Proxy, or nothing both times. */
export function sameFound(a: Found, b: Found): boolean {
  switch (a.kind) {
    case "data":
      return b.kind === "data" && a.value === b.value;
    case "accessor":
      return b.kind === "accessor" && a.get === b.get;
    case "proxy":
      return b.kind === "proxy" && a.proxy === b.proxy;
    case "absent":
      return b.kind === "absent";
  }
}

/**
 * True when two of the kernel's descriptors (ownDescriptor's, prototype-free), or none both times, are alike: the same
 * value or the same getter and setter, with the same attributes.
 */
export function sameDescriptor(
  a: PropertyDescriptor | undefined,
  b: PropertyDescriptor | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  const sameAttributes =
    a.writable === b.writable && a.enumerable === b.enumerable && a.configurable === b.configurable;
  return sameAttributes && a.value === b.value && a.get === b.get && a.set === b.set;
}
