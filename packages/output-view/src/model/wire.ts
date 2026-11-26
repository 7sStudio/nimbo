// Reads the wire form (core's serialize/form.ts) one node at a time: its kind, children and counts.
import type { Path } from "@jsnb/core";
import { markerType, unescapeKey } from "@jsnb/core";

/** What a wire-form node is; containers are the last five. */
export type WireKind =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "undefined"
  | "special"
  | "bigint"
  | "date"
  | "regexp"
  | "function"
  | "error"
  | "bytes"
  | "ref"
  | "truncated"
  | "object"
  | "instance"
  | "array"
  | "map"
  | "set";

export type JsonObject = Readonly<Record<string, unknown>>;

/** How a child is named in its parent: an object key, an array index, a Map key (a wire node) or a Set member. */
export type RowKey =
  | { readonly kind: "name"; readonly name: string }
  | { readonly kind: "index"; readonly index: number }
  | { readonly kind: "entry"; readonly node: unknown }
  | { readonly kind: "member" }
  | { readonly kind: "root" };

/** A child node and the path segments that lead to it from its parent (three for a Map value, two for a Set member). */
export type Child = { readonly key: RowKey; readonly segments: Path; readonly node: unknown };

/** A non-null, non-array JSON object. */
export const isJsonObject = (node: unknown): node is JsonObject =>
  typeof node === "object" && node !== null && !Array.isArray(node);

const markers: Readonly<Record<string, WireKind>> = {
  undefined: "undefined",
  number: "special",
  bigint: "bigint",
  date: "date",
  regexp: "regexp",
  function: "function",
  error: "error",
  bytes: "bytes",
  ref: "ref",
  truncated: "truncated",
  map: "map",
  set: "set",
};

const objectKind = (node: JsonObject): WireKind => {
  const tag = markerType(node);
  if (tag !== undefined) return markers[tag] ?? "object";
  return typeof node.$class === "string" ? "instance" : "object";
};

/** The kind of a wire-form node; an unknown `$type` reads as a plain object, anything that is not JSON as undefined. */
export function kindOf(node: unknown): WireKind {
  if (typeof node === "string") return "string";
  if (typeof node === "number") return "number";
  if (typeof node === "boolean") return "boolean";
  if (node === null) return "null";
  if (Array.isArray(node)) return "array";
  return isJsonObject(node) ? objectKind(node) : "undefined";
}

const containers: ReadonlySet<WireKind> = new Set(["object", "instance", "array", "map", "set"]);

/** Whether a kind has children (it may still have none). */
export const isContainer = (kind: WireKind): boolean => containers.has(kind);

/** A field of a marker as an array, or empty when the form is malformed. */
const listField = (node: unknown, field: string): readonly unknown[] => {
  const value: unknown = isJsonObject(node) ? node[field] : undefined;
  return Array.isArray(value) ? value : [];
};

/** The `[key, value]` pairs of a Map marker; a malformed entry reads as a pair of undefined. */
export const mapEntries = (node: unknown): readonly unknown[] => listField(node, "entries");

/** The members of a Set marker. */
export const setValues = (node: unknown): readonly unknown[] => listField(node, "values");

/** An object's keys as written on the wire, without the `$class` tag of an instance. */
export function fieldKeys(node: unknown, kind: WireKind): string[] {
  if (!isJsonObject(node)) return [];
  const keys = Object.keys(node);
  return kind === "instance" ? keys.filter((key) => key !== "$class") : keys;
}

/** How many children a node has: keys, items, entries or members; 0 for a leaf. */
export function childCount(node: unknown, kind: WireKind): number {
  switch (kind) {
    case "array":
      return Array.isArray(node) ? node.length : 0;
    case "map":
      return mapEntries(node).length;
    case "set":
      return setValues(node).length;
    case "object":
    case "instance":
      return fieldKeys(node, kind).length;
    default:
      return 0;
  }
}

const pairPart = (entry: unknown, index: 0 | 1): unknown =>
  Array.isArray(entry) ? entry[index] : undefined;

/** The first `limit` children of a container in wire order, each with the segments that address it from the parent. */
export function children(node: unknown, kind: WireKind, limit = Number.POSITIVE_INFINITY): Child[] {
  const end = Math.min(limit, Number.MAX_SAFE_INTEGER);
  switch (kind) {
    case "array":
      return (Array.isArray(node) ? node.slice(0, end) : []).map((element: unknown, index) => ({
        key: { kind: "index", index },
        segments: [index],
        node: element,
      }));
    case "map":
      return mapEntries(node)
        .slice(0, end)
        .map((entry, index) => ({
          key: { kind: "entry", node: pairPart(entry, 0) },
          segments: ["entries", index, 1],
          node: pairPart(entry, 1),
        }));
    case "set":
      return setValues(node)
        .slice(0, end)
        .map((member, index) => ({
          key: { kind: "member" },
          segments: ["values", index],
          node: member,
        }));
    default:
      return fieldKeys(node, kind)
        .slice(0, end)
        .map((key) => ({
          key: { kind: "name", name: unescapeKey(key) },
          segments: [key],
          node: isJsonObject(node) ? node[key] : undefined,
        }));
  }
}

/** A string field of a marker (`name`, `iso`, `value`, `$class`), or undefined when absent or not a string. */
export const textField = (node: unknown, field: string): string | undefined => {
  const value: unknown = isJsonObject(node) ? node[field] : undefined;
  return typeof value === "string" ? value : undefined;
};

/** The node a path addresses from the root, or undefined when a segment does not lead anywhere. */
export function resolve(root: unknown, path: Path): { readonly node: unknown } | undefined {
  let node: unknown = root;
  for (const segment of path) {
    if (typeof node !== "object" || node === null) return undefined;
    if (!Object.hasOwn(node, segment)) return undefined;
    node = Reflect.get(node, segment);
  }
  return { node };
}

/** The path a ref marker points at, or undefined for a malformed marker. */
export function refTarget(node: unknown): Path | undefined {
  const path: unknown = isJsonObject(node) ? node.path : undefined;
  return Array.isArray(path) && path.every(isSegment) ? path : undefined;
}

const isSegment = (value: unknown): value is string | number =>
  typeof value === "string" || typeof value === "number";
