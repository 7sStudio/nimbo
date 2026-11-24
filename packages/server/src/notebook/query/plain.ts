// A value's wire form (04-kernel §5.4) as plain JSON, the rows SQL mode loads as `t` (11-query §3): the rules of
// output-view's model/plain.ts, which the page applies before its own DuckDB load, so `t` holds the same rows on the
// daemon (server may not import output-view, 02 §2): dates as ISO text, bigints as digits, NaN as null, Maps with
// simple keys as objects, Sets as arrays, refs inlined up to a budget and cycles as a note.
import { markerType, unescapeKey } from "@jsnb/core";

type Node = Readonly<Record<string, unknown>>;
type Walk = {
  readonly root: unknown;
  readonly active: Set<object>;
  readonly budget: number;
  nodes: number;
};

/** Refs are inlined (a repeated object appears in full each time) up to this many nodes, then left as a note. */
const inlineBudget = 1_000_000;

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (node: Node, field: string): string | undefined => {
  const value = node[field];
  return typeof value === "string" ? value : undefined;
};
const list = (node: Node, field: string): readonly unknown[] => {
  const value = node[field];
  return Array.isArray(value) ? value : [];
};

/** Sets an own enumerable key, `__proto__` included (an assignment would change the prototype instead). */
const setOwn = (out: Record<string, unknown>, key: string, value: unknown): void => {
  Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
};

const leaves: Readonly<Record<string, (node: Node) => unknown>> = {
  undefined: () => undefined,
  number: (node) => (text(node, "value") === "-0" ? 0 : null),
  bigint: (node) => text(node, "value") ?? "0",
  date: (node) => text(node, "iso") ?? null,
  regexp: (node) => `/${text(node, "source") ?? ""}/${text(node, "flags") ?? ""}`,
  function: () => undefined,
  error: (node) => ({ name: text(node, "name") ?? "Error", message: text(node, "message") ?? "" }),
  bytes: (node) => text(node, "base64") ?? "",
  truncated: () => "[truncated]",
};

const shorthand = /^[A-Za-z_\u0080-퟿-\u{10FFFF}][A-Za-z_\u0080-퟿-\u{10FFFF}0-9]*$/u;
const quoted = (name: string): string =>
  `'${name.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;

/** The copy-path form `$.data[3]['first name']` the page writes in the same note. */
const formatPath = (path: readonly unknown[]): string =>
  `$${path
    .map((step) => {
      if (typeof step === "number") return `[${String(step)}]`;
      const name = String(step);
      return shorthand.test(name) ? `.${name}` : `[${quoted(name)}]`;
    })
    .join("")}`;

/** The node a ref's path leads to from the root, or undefined when a step leads nowhere. */
function target(root: unknown, path: readonly unknown[]): unknown {
  let found = root;
  for (const step of path) {
    const key = typeof step === "number" ? step : String(step);
    if (typeof found !== "object" || found === null || !Object.hasOwn(found, key)) return undefined;
    found = Reflect.get(found, key);
  }
  return found;
}

function ref(walk: Walk, node: Node): unknown {
  const path = list(node, "path");
  const found = target(walk.root, path);
  const isCycle = typeof found === "object" && found !== null && walk.active.has(found);
  if (found === undefined || isCycle || walk.nodes > walk.budget) {
    return `[${isCycle ? "Circular" : "Ref"} → ${formatPath(path)}]`;
  }
  return visit(walk, found);
}

const items = (walk: Walk, values: readonly unknown[]): unknown[] =>
  values.map((value) => visit(walk, value) ?? null);

/** A Map with string or number keys becomes an object; any other Map the array of its pairs. */
function mapOf(walk: Walk, node: Node): unknown {
  const pairs = list(node, "entries").map((entry): readonly unknown[] =>
    Array.isArray(entry) ? entry : [],
  );
  if (!pairs.every(([key]) => typeof key === "string" || typeof key === "number")) {
    return pairs.map(([key, value]) => [visit(walk, key) ?? null, visit(walk, value) ?? null]);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of pairs) {
    const plain = visit(walk, value);
    if (plain !== undefined) setOwn(out, String(key), plain);
  }
  return out;
}

function fields(walk: Walk, node: Node): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const instance = typeof node.$class === "string" && markerType(node) === undefined;
  for (const key of Object.keys(node)) {
    if (instance && key === "$class") continue;
    const value = visit(walk, node[key]);
    if (value !== undefined) setOwn(out, unescapeKey(key), value);
  }
  return out;
}

function visit(walk: Walk, node: unknown): unknown {
  walk.nodes += 1;
  if (Array.isArray(node)) return withActive(walk, node, () => items(walk, node));
  if (!isNode(node)) return node;
  const type = markerType(node);
  if (type === "ref") return ref(walk, node);
  const leaf = type === undefined ? undefined : leaves[type];
  if (leaf) return leaf(node);
  if (type === "map") return withActive(walk, node, () => mapOf(walk, node));
  if (type === "set") return withActive(walk, node, () => items(walk, list(node, "values")));
  return withActive(walk, node, () => fields(walk, node));
}

function withActive(walk: Walk, node: object, write: () => unknown): unknown {
  walk.active.add(node);
  const out = write();
  walk.active.delete(node);
  return out;
}

/** The plain JSON of a wire-form value; undefined for `undefined`. */
export const toPlain = (json: unknown, budget = inlineBudget): unknown =>
  visit({ root: json, active: new Set(), budget, nodes: 0 }, json);
