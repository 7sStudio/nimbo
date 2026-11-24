// "Copy as JavaScript literal": the wire form written as source that rebuilds the value, with
// `new Map`, `new Set`, `new Date`, `12n`, `NaN` and a comment where a value cannot be rebuilt (a cycle, a function).
import { decode, unescapeKey } from "@jsnb/core";

import { bytesLength, leafText } from "./leaf.js";
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

type Walk = {
  readonly root: unknown;
  readonly active: Set<object>;
  readonly budget: number;
  nodes: number;
};

const inlineBudget = 1_000_000;
const identifier = /^[A-Za-z_$][\w$]*$/;
const builtinErrors = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "EvalError",
  "URIError",
]);

/** A comment that cannot end early. */
const note = (text: string): string => `/* ${text.replaceAll("*/", "* /")} */`;

const keyText = (key: string): string => {
  if (key === "__proto__") return '["__proto__"]';
  return identifier.test(key) ? key : JSON.stringify(key);
};

function errorLiteral(node: unknown): string {
  const name = textField(node, "name") ?? "Error";
  const message = JSON.stringify(textField(node, "message") ?? "");
  if (builtinErrors.has(name)) return `new ${name}(${message})`;
  return `Object.assign(new Error(${message}), { name: ${JSON.stringify(name)} })`;
}

function bytesLiteral(node: unknown): string {
  const carried = decode({ $type: "bytes", length: 0, base64: textField(node, "base64") ?? "" });
  const list = carried instanceof Uint8Array ? [...carried].join(", ") : "";
  const length = bytesLength(node);
  const prefix =
    carried instanceof Uint8Array && carried.length < length
      ? `${note(`the first ${String(carried.length)} of ${String(length)} bytes`)} `
      : "";
  return `${prefix}new Uint8Array([${list}])`;
}

function functionLiteral(node: unknown): string {
  const name = textField(node, "name") ?? "";
  return identifier.test(name) ? `function ${name}() {}` : "function () {}";
}

const leaves: Partial<Record<WireKind, (node: unknown) => string>> = {
  string: (node) => JSON.stringify(node),
  number: (node) => (typeof node !== "number" ? "0" : Object.is(node, -0) ? "-0" : String(node)),
  boolean: (node) => (node === true ? "true" : "false"),
  null: () => "null",
  undefined: () => "undefined",
  special: (node) => textField(node, "value") ?? "NaN",
  bigint: (node) => leafText(node, "bigint"),
  date: (node) => {
    const iso = textField(node, "iso");
    return iso === undefined ? "new Date(NaN)" : `new Date(${JSON.stringify(iso)})`;
  },
  regexp: (node) => {
    const source = textField(node, "source") ?? "";
    return `/${source === "" ? "(?:)" : source}/${textField(node, "flags") ?? ""}`;
  },
  function: functionLiteral,
  error: errorLiteral,
  bytes: bytesLiteral,
  truncated: () => `undefined ${note("truncated")}`,
};

const indent = (depth: number): string => "  ".repeat(depth);

/** Items one per line, or the empty form when there are none. */
function block(open: string, lines: readonly string[], close: string, depth: number): string {
  if (lines.length === 0) return `${open}${close}`;
  const inner = lines.map((line) => `${indent(depth + 1)}${line},`).join("\n");
  return `${open}\n${inner}\n${indent(depth)}${close}`;
}

function ref(walk: Walk, node: unknown, depth: number): string {
  const target = refTarget(node) ?? [];
  const found = resolve(walk.root, target)?.node;
  const isCycle = typeof found === "object" && found !== null && walk.active.has(found);
  if (found === undefined || isCycle || walk.nodes > walk.budget) {
    return `undefined ${note(`${isCycle ? "circular" : "ref"} → ${formatPath(target)}`)}`;
  }
  return visit(walk, found, depth);
}

function container(walk: Walk, node: unknown, kind: WireKind, depth: number): string {
  const nested = (value: unknown): string => visit(walk, value, depth + 1);
  if (kind === "array")
    return block("[", (Array.isArray(node) ? node : []).map(nested), "]", depth);
  if (kind === "set") return block("new Set([", setValues(node).map(nested), "])", depth);
  if (kind === "map") {
    const pairs = mapEntries(node).map((entry): readonly unknown[] =>
      Array.isArray(entry) ? entry : [],
    );
    return block(
      "new Map([",
      pairs.map(([key, value]) => `[${nested(key)}, ${nested(value)}]`),
      "])",
      depth,
    );
  }
  const lines = fieldKeys(node, kind).map(
    (key) => `${keyText(unescapeKey(key))}: ${nested(isJsonObject(node) ? node[key] : undefined)}`,
  );
  const label = kind === "instance" ? `${note(textField(node, "$class") ?? "Object")} ` : "";
  return `${label}${block("{", lines, "}", depth)}`;
}

function visit(walk: Walk, node: unknown, depth: number): string {
  walk.nodes += 1;
  const kind = kindOf(node);
  if (kind === "ref") return ref(walk, node, depth);
  const leaf = leaves[kind];
  if (leaf || typeof node !== "object" || node === null) return leaf?.(node) ?? "undefined";
  walk.active.add(node);
  const out = container(walk, node, kind, depth);
  walk.active.delete(node);
  return out;
}

/**
 * JavaScript source that rebuilds the value, two-space indented; `root` resolves refs (default: the node itself). A
 * repeated object is written in full each time until `budget` nodes have been written, then as `undefined` and a note.
 */
export function toLiteral(json: unknown, root: unknown = json, budget = inlineBudget): string {
  return visit({ root, active: new Set(), budget, nodes: 0 }, json, 0);
}
