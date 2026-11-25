// The realm's inspector, Node `util.inspect` style (04-kernel §5.1, §5.2): one value to one line; it never throws.
// Own properties are read through their descriptors, so a getter shows as `[Getter]` and never runs.

export type InspectOptions = {
  readonly depth: number;
  readonly maxArrayLength: number;
  readonly maxStringLength: number;
  /** The whole result is cut to this many characters. */
  readonly maxLength: number;
};

type InspectContext = {
  readonly options: InspectOptions;
  readonly depth: number;
  /** The objects being printed above this one, for `[Circular *1]`. */
  readonly seen: readonly object[];
};

/** What `console.log` shows of an object: depth 2, as `util.format` does. */
export const consoleInspect: InspectOptions = {
  depth: 2,
  maxArrayLength: 100,
  maxStringLength: 10_000,
  maxLength: Number.POSITIVE_INFINITY,
};

/** A value output's `repr` (04-kernel §5.2): depth 3, 50 items, 500-character strings, 4 KB in all. */
export const reprInspect: InspectOptions = {
  depth: 3,
  maxArrayLength: 50,
  maxStringLength: 500,
  maxLength: 4096,
};

/** Runs `read`; a throw (a revoked proxy, a hostile trap) gives `fallback` instead. */
export function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    // Inspection never throws (04-kernel §5.2): whatever cannot be read is shown as the fallback.
    return fallback;
  }
}

const escapes: Readonly<Record<string, string>> = {
  "\n": "\\n",
  "\t": "\\t",
  "\r": "\\r",
  "\b": "\\b",
  "\f": "\\f",
  "\v": "\\v",
  "\\": "\\\\",
};

const escapeChar = (char: string): string => {
  const code = char.charCodeAt(0);
  if (char !== "\\" && code >= 0x20 && code !== 0x7f) return char;
  return escapes[char] ?? `\\x${code.toString(16).padStart(2, "0")}`;
};

/** Single quotes unless the text holds one, then double quotes, then backticks; control characters escaped. */
function quote(text: string): string {
  const mark = ["'", '"', "`"].find((candidate) => !text.includes(candidate)) ?? "'";
  // The chosen mark is escaped only when the text holds all three.
  const body = Array.from(text, escapeChar).join("").replaceAll(mark, `\\${mark}`);
  return `${mark}${body}${mark}`;
}

/** A quoted string, cut at `maxStringLength` with Node's `... n more characters`. */
function formatString(text: string, options: InspectOptions): string {
  if (text.length <= options.maxStringLength) return quote(text);
  const rest = text.length - options.maxStringLength;
  return `${quote(text.slice(0, options.maxStringLength))}... ${String(rest)} more characters`;
}

/** `[Function: f]`, `[AsyncFunction: f]`, `[class C]`, `[Function (anonymous)]`. */
function formatFunction(fn: object): string {
  const name = safe(() => String(Reflect.get(fn, "name")), "");
  const source = safe(() => Function.prototype.toString.call(fn), "");
  if (source.startsWith("class")) return `[class ${name === "" ? "(anonymous)" : name}]`;
  const tag = safe(() => Object.prototype.toString.call(fn).slice(8, -1), "Function");
  const kind = tag.endsWith("Function") ? tag : "Function";
  return name === "" ? `[${kind} (anonymous)]` : `[${kind}: ${name}]`;
}

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

function propertyText(value: object, key: string | symbol, context: InspectContext): string {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor?.get && descriptor.set) return "[Getter/Setter]";
  if (descriptor?.get) return "[Getter]";
  if (descriptor?.set) return "[Setter]";
  return formatNested(descriptor?.value, context);
}

const isEnumerable = (value: object, key: string | symbol): boolean =>
  safe(() => Object.getOwnPropertyDescriptor(value, key)?.enumerable === true, false);

function properties(value: object, context: InspectContext): string[] {
  const keys = safe(() => Reflect.ownKeys(value), []).filter((key) => isEnumerable(value, key));
  const shown = (key: string | symbol) =>
    safe(() => propertyText(value, key, context), "[Inaccessible]");
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
function arrayItems(value: Indexed, context: InspectContext): string[] {
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
    items.push(descriptor.get ? "[Getter]" : formatNested(descriptor.value, context));
  }
  flushHoles();
  const rest = value.length - shown;
  return rest > 0 ? [...items, `... ${plural(rest, "more item")}`] : items;
}

function collection(value: Map<unknown, unknown> | Set<unknown>, context: InspectContext) {
  const items: string[] = [];
  for (const [key, item] of value.entries()) {
    if (items.length >= context.options.maxArrayLength) break;
    const text = formatNested(item, context);
    items.push(value instanceof Map ? `${formatNested(key, context)} => ${text}` : text);
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

function container(value: object, context: InspectContext): string {
  if (Array.isArray(value)) return braces("[", arrayItems(value, context), "]");
  if (isTypedArray(value)) {
    const head = `${prefixOf(value).trim()}(${String(value.length)}) [`;
    return braces(head, arrayItems(value, context), "]");
  }
  if (value instanceof Map || value instanceof Set) return collection(value, context);
  return braces(`${prefixOf(value)}{`, properties(value, context), "}");
}

/** Cycles become `[Circular *1]`, values past the depth `[Object]`, `[Array]` or `[ClassName]`. */
function formatObject(value: object, context: InspectContext): string {
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
  return container(value, inner);
}

function formatValue(value: unknown, context: InspectContext): string {
  switch (typeof value) {
    case "string":
      return formatString(value, context.options);
    case "number":
      return Object.is(value, -0) ? "-0" : String(value);
    case "bigint":
      return `${value.toString()}n`;
    case "symbol":
      return value.toString();
    case "function":
      return formatFunction(value);
    case "object":
      return value === null ? "null" : formatObject(value, context);
    default:
      return String(value);
  }
}

/** A nested value: whatever cannot be read shows as `[Inaccessible]` and the rest of the value still prints. */
function formatNested(value: unknown, context: InspectContext): string {
  return safe(() => formatValue(value, context), "[Inaccessible]");
}

/** Node's `util.inspect` for one value: never throws, on Proxies, throwing getters and revoked proxies alike. */
export function inspect(value: unknown, options: InspectOptions): string {
  const text = formatNested(value, { options, depth: 0, seen: [] });
  return text.length > options.maxLength ? `${text.slice(0, options.maxLength - 1)}…` : text;
}
