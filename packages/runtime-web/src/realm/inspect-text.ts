// The inspector's leaves (04-kernel §5.2): its options, quoting and cutting strings, naming functions, never throwing.

export type InspectOptions = {
  readonly depth: number;
  readonly maxArrayLength: number;
  readonly maxStringLength: number;
  /** The whole result is cut to this many characters. */
  readonly maxLength: number;
};

export type InspectContext = {
  readonly options: InspectOptions;
  readonly depth: number;
  /** The objects being printed above this one, for `[Circular *1]`. */
  readonly seen: readonly object[];
};

export type Format = (value: unknown, context: InspectContext) => string;

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
export function quote(text: string): string {
  const mark = ["'", '"', "`"].find((candidate) => !text.includes(candidate)) ?? "'";
  // The chosen mark is escaped only when the text holds all three.
  const body = Array.from(text, escapeChar).join("").replaceAll(mark, `\\${mark}`);
  return `${mark}${body}${mark}`;
}

/** A quoted string, cut at `maxStringLength` with Node's `... n more characters`. */
export function formatString(text: string, options: InspectOptions): string {
  if (text.length <= options.maxStringLength) return quote(text);
  const rest = text.length - options.maxStringLength;
  return `${quote(text.slice(0, options.maxStringLength))}... ${String(rest)} more characters`;
}

/** `[Function: f]`, `[AsyncFunction: f]`, `[class C]`, `[Function (anonymous)]`. */
export function formatFunction(fn: object): string {
  const name = safe(() => String(Reflect.get(fn, "name")), "");
  const source = safe(() => Function.prototype.toString.call(fn), "");
  if (source.startsWith("class")) return `[class ${name === "" ? "(anonymous)" : name}]`;
  const tag = safe(() => Object.prototype.toString.call(fn).slice(8, -1), "Function");
  const kind = tag.endsWith("Function") ? tag : "Function";
  return name === "" ? `[${kind} (anonymous)]` : `[${kind}: ${name}]`;
}
