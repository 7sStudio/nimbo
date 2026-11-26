// Paths into the wire form: the copy-path form `$.data[3].metadata` and RFC 9535 normalized paths `$['data'][3]`.
// It repeats the singular-path part of query-json's paths.ts on purpose: output-view may import core only.
import type { Path } from "@jsnb/core";

export type PathError = { readonly message: string; readonly position: number };
export type PathResult =
  { readonly ok: true; readonly value: Path } | { readonly ok: false; readonly error: PathError };

type Scan<T> = { readonly value: T; readonly end: number } | undefined;

const nameChars = "A-Za-z_\\u0080-\\uD7FF\\uE000-\\u{10FFFF}";
const shorthand = new RegExp(`^[${nameChars}][${nameChars}0-9]*$`, "u");
const nameAt = new RegExp(`[${nameChars}][${nameChars}0-9]*`, "uy");
const indexAt = /0|[1-9][0-9]*/y;
const hex4 = /[0-9a-fA-F]{4}/y;

const normalEscapes: Readonly<Record<string, string>> = {
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "'": "\\'",
  "\\": "\\\\",
};

const escapeChar = (ch: string): string =>
  normalEscapes[ch] ?? (ch < " " ? `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}` : ch);

/** A member name in single quotes with the minimal escapes of RFC 9535 §2.7. */
const quoteName = (name: string): string => `'${Array.from(name, escapeChar).join("")}'`;

/** Whether a member name can be written as `.name` (RFC 9535 member-name-shorthand). */
const isShorthand = (name: string): boolean => shorthand.test(name);

/** One step in the copy-path form: `.name`, `['odd name']` or `[3]`. */
export function segmentText(segment: string | number): string {
  if (typeof segment === "number") return `[${String(segment)}]`;
  return isShorthand(segment) ? `.${segment}` : `[${quoteName(segment)}]`;
}

/** The copy-path form, `$.data[3]['first name']`; it is also each row's id. */
export const formatPath = (path: Path): string => `$${path.map(segmentText).join("")}`;

/** The RFC 9535 §2.7 normalized path, `$['data'][3]`, the form select engines return. */
export const normalizedPath = (path: Path): string =>
  `$${path.map((s) => (typeof s === "number" ? `[${String(s)}]` : `[${quoteName(s)}]`)).join("")}`;

/** A relative path as a chip key, without `$` and the first dot: `metadata.order_id`, `['first name']`, `items[0]`. */
export const formatKey = (path: Path): string => formatPath(path).slice(1).replace(/^\./, "");

const simpleEscapes: Readonly<Record<string, string>> = {
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  "/": "/",
  "\\": "\\",
  "'": "'",
  '"': '"',
};

function scanEscape(text: string, at: number): Scan<string> {
  const ch = text.charAt(at);
  const simple = simpleEscapes[ch];
  if (simple !== undefined) return { value: simple, end: at + 1 };
  hex4.lastIndex = at + 1;
  if (ch !== "u" || !hex4.test(text)) return undefined;
  return { value: String.fromCharCode(parseInt(text.slice(at + 1, at + 5), 16)), end: at + 5 };
}

/** A single- or double-quoted string literal at `at`, with JSON escapes; undefined when there is none. */
export function scanString(text: string, at: number): Scan<string> {
  const quote = text.charAt(at);
  if (quote !== "'" && quote !== '"') return undefined;
  let value = "";
  for (let index = at + 1; index < text.length;) {
    const ch = text.charAt(index);
    if (ch === quote) return { value, end: index + 1 };
    const next = ch === "\\" ? scanEscape(text, index + 1) : { value: ch, end: index + 1 };
    if (next === undefined || ch < " ") return undefined;
    value += next.value;
    index = next.end;
  }
  return undefined;
}

function scanSticky(pattern: RegExp, text: string, at: number): Scan<string> {
  pattern.lastIndex = at;
  const match = pattern.exec(text);
  return match === null ? undefined : { value: match[0], end: pattern.lastIndex };
}

function scanIndex(text: string, at: number): Scan<number> {
  const digits = scanSticky(indexAt, text, at);
  const value = Number(digits?.value);
  return digits && Number.isSafeInteger(value) ? { value, end: digits.end } : undefined;
}

function scanSegment(text: string, at: number): Scan<string | number> {
  const lead = text.charAt(at);
  if (lead === ".") return scanSticky(nameAt, text, at + 1);
  if (lead !== "[") return undefined;
  const inner: Scan<string | number> = scanString(text, at + 1) ?? scanIndex(text, at + 1);
  return inner && text.charAt(inner.end) === "]"
    ? { value: inner.value, end: inner.end + 1 }
    : undefined;
}

/** Reads as many singular segments as follow `at`. */
function scanSegments(text: string, at: number): { readonly value: Path; readonly end: number } {
  const segments: (string | number)[] = [];
  let end = at;
  for (let next = scanSegment(text, end); next; next = scanSegment(text, end)) {
    segments.push(next.value);
    end = next.end;
  }
  return { value: segments, end };
}

const failure = (message: string, position: number): PathResult => ({
  ok: false,
  error: { message, position },
});

/** Parses `$`, the copy-path form or a normalized path into its segments. */
export function parsePath(text: string): PathResult {
  if (!text.startsWith("$")) {
    return failure(`A path starts with "$", as in $.data[3]; ${JSON.stringify(text)} does not.`, 0);
  }
  const { value, end } = scanSegments(text, 1);
  if (end === text.length) return { ok: true, value };
  const message = `The path ${JSON.stringify(text)} is invalid at position ${String(end)}: write each step as .name, ['name'] or [index].`;
  return failure(message, end);
}

/** A chip key read as a relative singular path (`metadata.order_id`, `items[0]`), or undefined when it is not one. */
export function parseKey(key: string): Path | undefined {
  const parsed = parsePath(key.startsWith("[") ? `$${key}` : `$.${key}`);
  return parsed.ok && parsed.value.length > 0 ? parsed.value : undefined;
}

/** Whether `ancestor` is a proper prefix of `path`. */
export const isAncestor = (ancestor: Path, path: Path): boolean =>
  ancestor.length < path.length && ancestor.every((segment, i) => segment === path[i]);

/** The ids (copy-path form) of every proper prefix of a path, the root first. */
export function ancestorIds(path: Path): string[] {
  const ids: string[] = [];
  let id = "$";
  for (const segment of path) {
    ids.push(id);
    id += segmentText(segment);
  }
  return ids;
}

/** The path utilities of the public API, as one object (lists `paths`). */
export const paths = {
  parse: parsePath,
  format: formatPath,
  normalized: normalizedPath,
  key: formatKey,
  parseKey,
  isAncestor,
  ancestors: ancestorIds,
} as const;
