// The wire form as plain JSON, for "copy as JSON", JSON, NDJSON and CSV exports: what JSON.stringify of the live value
// would say, plus readable text for what JSON cannot hold (dates as ISO, bigints as digits, cycles as a note).
import { unescapeKey } from "@jsnb/core";

import { leafText } from "./leaf.js";
import { formatPath } from "./path.js";
import type { WireKind } from "./wire.js";
import {
  fieldKeys,
  isJsonObject,
  kindOf,
  mapEntries,
  refTarget,
  resolve,
  setValues,
  textField,
} from "./wire.js";

/** Refs are inlined (a repeated object appears in full each time) up to this many nodes, then left as a note. */
const inlineBudget = 1_000_000;

type Walk = {
  readonly root: unknown;
  readonly active: Set<object>;
  readonly budget: number;
  nodes: number;
};

/** Sets an own enumerable key, `__proto__` included (an assignment would change the prototype instead). */
const setOwn = (out: Record<string, unknown>, key: string, value: unknown): void => {
  Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
};

const specials: Readonly<Record<string, number | null>> = { "-0": 0 };

const leaves: Partial<Record<WireKind, (node: unknown) => unknown>> = {
  undefined: () => undefined,
  special: (node) => specials[textField(node, "value") ?? ""] ?? null,
  bigint: (node) => textField(node, "value") ?? "0",
  date: (node) => textField(node, "iso") ?? null,
  regexp: (node) => leafText(node, "regexp"),
  function: () => undefined,
  error: (node) => ({
    name: textField(node, "name") ?? "Error",
    message: textField(node, "message") ?? "",
  }),
  bytes: (node) => textField(node, "base64") ?? "",
  truncated: () => "[truncated]",
};

function ref(walk: Walk, node: unknown): unknown {
  const target = refTarget(node) ?? [];
  const found = resolve(walk.root, target)?.node;
  const isCycle = typeof found === "object" && found !== null && walk.active.has(found);
  if (found === undefined || isCycle || walk.nodes > walk.budget) {
    return `[${isCycle ? "Circular" : "Ref"} → ${formatPath(target)}]`;
  }
  return visit(walk, found);
}

/** Array items: JSON.stringify writes null for undefined and functions. */
const items = (walk: Walk, list: readonly unknown[]): unknown[] =>
  list.map((element) => visit(walk, element) ?? null);

function fields(walk: Walk, node: unknown, kind: WireKind): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of fieldKeys(node, kind)) {
    const value = visit(walk, isJsonObject(node) ? node[key] : undefined);
    if (value !== undefined) setOwn(out, unescapeKey(key), value);
  }
  return out;
}

/** A Map with string or number keys becomes an object; any other Map the array of its pairs. */
function map(walk: Walk, node: unknown): unknown {
  const pairs = mapEntries(node).map((entry): readonly unknown[] =>
    Array.isArray(entry) ? entry : [],
  );
  const simple = pairs.every(([key]) => typeof key === "string" || typeof key === "number");
  if (!simple)
    return pairs.map(([key, value]) => [visit(walk, key) ?? null, visit(walk, value) ?? null]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of pairs) {
    const plain = visit(walk, value);
    if (plain !== undefined) setOwn(out, String(key), plain);
  }
  return out;
}

function container(walk: Walk, node: unknown, kind: WireKind): unknown {
  if (kind === "array") return items(walk, Array.isArray(node) ? node : []);
  if (kind === "set") return items(walk, setValues(node));
  return kind === "map" ? map(walk, node) : fields(walk, node, kind);
}

function visit(walk: Walk, node: unknown): unknown {
  walk.nodes += 1;
  const kind = kindOf(node);
  if (kind === "ref") return ref(walk, node);
  const leaf = leaves[kind];
  if (leaf) return leaf(node);
  if (typeof node !== "object" || node === null) return node;
  walk.active.add(node);
  const out = container(walk, node, kind);
  walk.active.delete(node);
  return out;
}

/**
 * The plain JSON of a wire-form node; `root` resolves refs (default: the node itself). Undefined for `undefined`. A
 * repeated object is written in full each time until `budget` nodes have been written, then as a note.
 */
export function toPlain(json: unknown, root: unknown = json, budget = inlineBudget): unknown {
  return visit({ root, active: new Set(), budget, nodes: 0 }, json);
}
