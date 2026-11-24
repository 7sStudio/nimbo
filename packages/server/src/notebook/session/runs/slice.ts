// cell.outputValue's slice (03-api §4.3, "load more"): the children of a path in a value's wire form
// from an offset, at most `limit`, each child itself capped so the answer stays within the byte budget; a cut child
// carries core's truncated marker where it was cut, as the kernel's own encoder marks it (04-kernel §5.4).
import { truncatedMarker } from "@jsnb/core";

export type Slice = { readonly json: unknown; readonly total: number; readonly truncated: boolean };

type Budget = { left: number; cut: boolean };

const maxDepth = 32;

const isObject = (node: unknown): node is Readonly<Record<string, unknown>> =>
  typeof node === "object" && node !== null && !Array.isArray(node);

/** `node` within the budget: a leaf whole or not at all, a container as far as its children fit. */
function capped(node: unknown, budget: Budget, depth: number): unknown {
  if (typeof node !== "object" || node === null) {
    const size = typeof node === "string" ? JSON.stringify(node).length : String(node).length;
    if (size > budget.left) return cutHere(budget);
    budget.left -= size;
    return node;
  }
  if (depth >= maxDepth) return cutHere(budget);
  budget.left -= 2;
  if (Array.isArray(node)) return cappedArray(node, budget, depth);
  return isObject(node) ? cappedObject(node, budget, depth) : cutHere(budget);
}

function cutHere(budget: Budget): unknown {
  budget.cut = true;
  budget.left = 0;
  return truncatedMarker;
}

function cappedArray(items: readonly unknown[], budget: Budget, depth: number): unknown[] {
  const out: unknown[] = [];
  for (const item of items) {
    if (out.length > 0) budget.left -= 1; // the comma
    if (budget.left <= 0) {
      out.push(cutHere(budget));
      break;
    }
    out.push(capped(item, budget, depth + 1));
  }
  return out;
}

/** Entries through Object.fromEntries, so a `__proto__` key stays an own key and changes no prototype. */
function cappedObject(
  node: Readonly<Record<string, unknown>>,
  budget: Budget,
  depth: number,
): unknown {
  const out: [string, unknown][] = [];
  for (const [key, value] of Object.entries(node)) {
    budget.left -= key.length + (out.length > 0 ? 4 : 3); // "key": and the comma before it
    out.push([key, budget.left <= 0 ? cutHere(budget) : capped(value, budget, depth + 1)]);
    if (budget.cut) break;
  }
  return Object.fromEntries(out);
}

/** One child of a slice, every child present: whole, or cut with the marker where the budget ran out. */
function child(value: unknown, at: number, budget: Budget): unknown {
  if (at > 0) budget.left -= 1; // the comma
  return budget.left <= 0 ? cutHere(budget) : capped(value, budget, 1);
}

/** The node at `path` (plain JSON steps into the wire form), or undefined when a step leads nowhere. */
export function nodeAt(
  root: unknown,
  path: readonly (string | number)[],
): { readonly node: unknown } | undefined {
  let node = root;
  for (const step of path) {
    if (typeof node !== "object" || node === null || !Object.hasOwn(node, step)) return undefined;
    node = Reflect.get(node, step);
  }
  return { node };
}

/** The children of `node` from `offset`, at most `limit`, within `maxBytes`. */
export function sliceOf(
  node: unknown,
  range: { readonly offset: number; readonly limit: number },
  maxBytes: number,
): Slice {
  const budget: Budget = { left: maxBytes, cut: false };
  const end = range.offset + range.limit;
  if (Array.isArray(node)) {
    const items = node.slice(range.offset, end).map((item: unknown, at) => child(item, at, budget));
    return { json: items, total: node.length, truncated: budget.cut || end < node.length };
  }
  if (isObject(node)) {
    const entries = Object.entries(node);
    const kept = entries.slice(range.offset, end).map(([key, value], at) => {
      budget.left -= key.length + 3;
      return [key, child(value, at, budget)];
    });
    return {
      json: Object.fromEntries(kept),
      total: entries.length,
      truncated: budget.cut || end < entries.length,
    };
  }
  return { json: capped(node, budget, 0), total: 0, truncated: budget.cut };
}
