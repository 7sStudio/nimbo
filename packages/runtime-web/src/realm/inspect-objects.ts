// The inspector's objects (04-kernel §5.2): arrays, Maps, Sets, class instances, dates, errors and DOM nodes.
// Own properties are read through their descriptors, so a getter shows as `[Getter]` and never runs.
import type { Format, InspectContext } from "./inspect-text.js";
import { quote, safe } from "./inspect-text.js";

const identifier = /^[A-Za-z_$][\w$]*$/;

const keyText = (key: string | symbol): string =>
  typeof key === "symbol" ? `[${key.toString()}]` : identifier.test(key) ? key : quote(key);

const tagOf = (value: object): string => safe(() => Object.prototype.toString.call(value), "");

const plural = (count: number, noun: string): string =>
  `${String(count)} ${noun}${count === 1 ? "" : "s"}`;

/** `Price ` for an instance, nothing for a plain object, `[Object: null prototype] ` without a prototype. */
function prefixOf(value: object): string {
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto === null) return "[Object: null prototype] ";
  if (proto === Object.prototype || typeof proto !== "object") return "";
  const ctor = safe((): unknown => Reflect.get(proto, "constructor"), undefined);
  const name = typeof ctor === "function" ? ctor.name : "";
  return name === "" || name === "Object" ? "" : `${name} `;
}

function propertyText(
  value: object,
  key: string | symbol,
  context: InspectContext,
  format: Format,
): string {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor?.get && descriptor.set) return "[Getter/Setter]";
  if (descriptor?.get) return "[Getter]";
  if (descriptor?.set) return "[Setter]";
  return format(descriptor?.value, context);
}

const isEnumerable = (value: object, key: string | symbol): boolean =>
  safe(() => Object.getOwnPropertyDescriptor(value, key)?.enumerable === true, false);

function properties(value: object, context: InspectContext, format: Format): string[] {
  const keys = safe(() => Reflect.ownKeys(value), []).filter((key) => isEnumerable(value, key));
  const shown = (key: string | symbol) =>
    safe(() => propertyText(value, key, context, format), "[Inaccessible]");
  return keys.map((key) => `${keyText(key)}: ${shown(key)}`);
}

const braces = (open: string, items: readonly string[], close: string): string =>
  items.length === 0 ? `${open}${close}` : `${open} ${items.join(", ")} ${close}`;

const withMore = (items: readonly string[], total: number): string[] =>
  total > items.length
    ? [...items, `... ${plural(total - items.length, "more item")}`]
    : [...items];

type Indexed = ArrayLike<unknown> & object;

const isTypedArray = (value: object): value is Indexed =>
  ArrayBuffer.isView(value) && !(value instanceof DataView);

/** Items through their descriptors: holes as `<n empty items>`, getters as `[Getter]`. */
function arrayItems(value: Indexed, context: InspectContext, format: Format): string[] {
  const shown = Math.min(value.length, context.options.maxArrayLength);
  const items: string[] = [];
  let holes = 0;
  const flushHoles = (): void => {
    if (holes > 0) items.push(`<${plural(holes, "empty item")}>`);
    holes = 0;
  };
  for (let index = 0; index < shown; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (descriptor === undefined) {
      holes += 1;
      continue;
    }
    flushHoles();
    items.push(descriptor.get ? "[Getter]" : format(descriptor.value, context));
  }
  flushHoles();
  const rest = value.length - shown;
  return rest > 0 ? [...items, `... ${plural(rest, "more item")}`] : items;
}

function collection(
  value: Map<unknown, unknown> | Set<unknown>,
  context: InspectContext,
  format: Format,
) {
  const items: string[] = [];
  for (const [key, item] of value.entries()) {
    if (items.length >= context.options.maxArrayLength) break;
    const text = format(item, context);
    items.push(value instanceof Map ? `${format(key, context)} => ${text}` : text);
  }
  const name = value instanceof Map ? "Map" : "Set";
  return braces(`${name}(${String(value.size)}) {`, withMore(items, value.size), "}");
}

/** `<div id="x" class="y">`, `#document`, `#text 'a'`; other nodes by their node name. */
function formatNode(node: Node): string {
  if (node instanceof Element) {
    const id = node.id === "" ? "" : ` id="${node.id}"`;
    const classes = node.getAttribute("class");
    return `<${node.localName}${id}${classes === null ? "" : ` class="${classes}"`}>`;
  }
  if (node.nodeType === Node.DOCUMENT_NODE) return "#document";
  if (node instanceof Text) return `#text ${quote(node.data)}`;
  return `[${node.nodeName}]`;
}

/** A string own or inherited field of an error, read safely: a hostile getter or a non-string gives `fallback`. */
const textField = (error: Error, key: "name" | "message", fallback: string): string => {
  const value = safe((): unknown => Reflect.get(error, key), fallback);
  return typeof value === "string" ? value : fallback;
};

const errorText = (error: Error): string => {
  const name = textField(error, "name", "Error");
  const message = textField(error, "message", "");
  return message === "" ? name : `${name}: ${message}`;
};

/** Printed without looking inside: dates, regexps, errors, DOM nodes, the window, weak collections, promises. */
function leaf(value: object): string | undefined {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  if (value instanceof RegExp) return String(value);
  if (value instanceof Error) return errorText(value);
  if (value instanceof Node) return formatNode(value);
  const tag = tagOf(value);
  if (tag === "[object Window]") return "[Window]";
  if (tag === "[object WeakMap]" || tag === "[object WeakSet]")
    return `${tag.slice(8, -1)} { <items unknown> }`;
  return tag === "[object Promise]" ? "Promise { <unknown> }" : undefined;
}

function container(value: object, context: InspectContext, format: Format): string {
  if (Array.isArray(value)) return braces("[", arrayItems(value, context, format), "]");
  if (isTypedArray(value)) {
    const head = `${prefixOf(value).trim()}(${String(value.length)}) [`;
    return braces(head, arrayItems(value, context, format), "]");
  }
  if (value instanceof Map || value instanceof Set) return collection(value, context, format);
  return braces(`${prefixOf(value)}{`, properties(value, context, format), "}");
}

/** Cycles become `[Circular *1]`, values past the depth `[Object]`, `[Array]` or `[ClassName]`. */
export function formatObject(value: object, context: InspectContext, format: Format): string {
  const simple = leaf(value);
  if (simple !== undefined) return simple;
  if (context.seen.includes(value)) return "[Circular *1]";
  if (context.depth > context.options.depth) {
    if (Array.isArray(value)) return "[Array]";
    const name = prefixOf(value).trim();
    if (name.startsWith("[")) return name;
    return `[${name === "" ? "Object" : name}]`;
  }
  const inner = { ...context, depth: context.depth + 1, seen: [...context.seen, value] };
  return container(value, inner, format);
}
