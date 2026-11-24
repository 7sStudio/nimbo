// decode: rebuilds the runtime value of a wire form (form.ts), resolving refs so cycles and identity come back.
import { fromBase64 } from "./bytes.js";
import type { Path } from "./form.js";
import { markerType, unescapeKey } from "./form.js";

type Json = Record<string, unknown>;
type State = { readonly root: unknown; readonly decoded: Map<object, unknown> };

const isJsonObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The runtime value of a serialized form; markers without a runtime form (truncated, error, function) stay as plain objects. */
export function decode(json: unknown): unknown {
  return visit(json, { root: json, decoded: new Map() });
}

function visit(node: unknown, state: State): unknown {
  if (Array.isArray(node)) {
    const out: unknown[] = [];
    state.decoded.set(node, out);
    for (const item of node) out.push(visit(item, state));
    return out;
  }
  if (!isJsonObject(node)) return node;
  const type = markerType(node);
  return type === undefined ? plain(node, state) : marker(node, type, state);
}

function plain(node: Json, state: State): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  state.decoded.set(node, out);
  for (const [key, value] of Object.entries(node)) out[unescapeKey(key)] = visit(value, state);
  return out;
}

const specialNumbers: Readonly<Record<string, number>> = {
  NaN: Number.NaN,
  Infinity: Number.POSITIVE_INFINITY,
  "-Infinity": Number.NEGATIVE_INFINITY,
  "-0": -0,
};

const markers: Readonly<Record<string, (node: Json, state: State) => unknown>> = {
  undefined: () => undefined,
  number: (node) =>
    typeof node.value === "string" ? (specialNumbers[node.value] ?? Number(node.value)) : node,
  bigint: (node) => (typeof node.value === "string" ? BigInt(node.value) : node),
  date: (node) => (typeof node.iso === "string" ? new Date(node.iso) : new Date(Number.NaN)),
  regexp: (node) =>
    new RegExp(
      typeof node.source === "string" ? node.source : "",
      typeof node.flags === "string" ? node.flags : "",
    ),
  bytes: (node) => fromBase64(typeof node.base64 === "string" ? node.base64 : ""),
  map,
  set,
  ref,
};

function marker(node: Json, type: string, state: State): unknown {
  const rebuild = markers[type];
  return rebuild ? rebuild(node, state) : plain(node, state);
}

function map(node: Json, state: State): Map<unknown, unknown> {
  const out = new Map<unknown, unknown>();
  state.decoded.set(node, out);
  const entries = Array.isArray(node.entries) ? node.entries : [];
  for (const entry of entries) {
    if (Array.isArray(entry)) out.set(visit(entry[0], state), visit(entry[1], state));
  }
  return out;
}

function set(node: Json, state: State): Set<unknown> {
  const out = new Set<unknown>();
  state.decoded.set(node, out);
  const values = Array.isArray(node.values) ? node.values : [];
  for (const value of values) out.add(visit(value, state));
  return out;
}

/** Follows the marker's path through the wire form and returns what that node decoded to. */
function ref(node: Json, state: State): unknown {
  const path: Path = Array.isArray(node.path) ? node.path.filter(isSegment) : [];
  let target: unknown = state.root;
  for (const segment of path) {
    if (typeof target !== "object" || target === null) return node;
    target = Reflect.get(target, segment);
  }
  if (typeof target !== "object" || target === null) return node;
  return state.decoded.has(target) ? state.decoded.get(target) : node;
}

const isSegment = (value: unknown): value is string | number =>
  typeof value === "string" || typeof value === "number";
