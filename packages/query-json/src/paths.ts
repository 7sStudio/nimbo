// Normalized path utilities shared with output-view (11-query §2): parse, format, parent and join.
import type { NormalizedPath } from "./engine.ts";
import type { Result } from "./errors.ts";
import { fail, ok } from "./errors.ts";
import type { Scan } from "./literal.ts";
import { quoteName, scanString } from "./literal.ts";

/** One step of a path: a member name or an array index. */
export type PathSegment = string | number;

const shorthandName = /[A-Za-z_\u0080-퟿-\u{10FFFF}][\w\u0080-퟿-\u{10FFFF}]*/uy;
const index = /0|[1-9][0-9]*/y;

const scanSticky = (pattern: RegExp, text: string, at: number): Scan<string> | undefined => {
  pattern.lastIndex = at;
  const match = pattern.exec(text);
  return match === null ? undefined : { value: match[0], end: pattern.lastIndex };
};

/** Whether a member name can be written as `.name` (RFC 9535 member-name-shorthand). */
export const isShorthandName = (name: string): boolean =>
  scanSticky(shorthandName, name, 0)?.end === name.length;

const scanIndex = (text: string, at: number): Scan<number> | undefined => {
  const digits = scanSticky(index, text, at);
  if (digits === undefined) return undefined;
  const value = Number(digits.value);
  return Number.isSafeInteger(value) ? { value, end: digits.end } : undefined;
};

const scanBracket = (text: string, at: number): Scan<PathSegment> | undefined => {
  const inner: Scan<PathSegment> | undefined = scanString(text, at) ?? scanIndex(text, at);
  return inner && text.charAt(inner.end) === "]"
    ? { value: inner.value, end: inner.end + 1 }
    : undefined;
};

/** Reads one singular segment at `at`: `.name`, `['name']`, `["name"]` or `[3]`. */
const scanSegment = (text: string, at: number): Scan<PathSegment> | undefined => {
  const lead = text.charAt(at);
  if (lead === ".") return scanSticky(shorthandName, text, at + 1);
  return lead === "[" ? scanBracket(text, at + 1) : undefined;
};

/** Reads as many singular segments as follow `at`. */
export const scanSegments = (text: string, at: number): Scan<readonly PathSegment[]> => {
  const segments: PathSegment[] = [];
  let end = at;
  for (let next = scanSegment(text, end); next; next = scanSegment(text, end)) {
    segments.push(next.value);
    end = next.end;
  }
  return { value: segments, end };
};

/** Parses `$`, a normalized path or a shorthand singular path (`$.data[3]['first name']`) into its segments. */
export const parsePath = (path: string): Result<readonly PathSegment[]> => {
  if (!path.startsWith("$")) {
    return fail(
      "syntax",
      `A path starts with "$", as in $.data[3]; ${JSON.stringify(path)} does not.`,
      0,
    );
  }
  const { value, end } = scanSegments(path, 1);
  if (end === path.length) return ok(value);
  const message = `The path ${JSON.stringify(path)} is invalid at position ${String(end)}; write each step as .name, ['name'] or [index].`;
  return fail("syntax", message, end);
};

/** The normalized path of the given segments: `$['data'][3]`. */
export const formatPath = (segments: readonly PathSegment[]): NormalizedPath =>
  `$${segments.map((s) => (typeof s === "number" ? `[${String(s)}]` : `[${quoteName(s)}]`)).join("")}`;

/** The normalized path of the parent node; undefined for `$` and for a path that does not parse. */
export const parentPath = (path: string): NormalizedPath | undefined => {
  const parsed = parsePath(path);
  return parsed.ok && parsed.value.length > 0 ? formatPath(parsed.value.slice(0, -1)) : undefined;
};

/** The normalized path of `path` followed by `segments`; undefined when `path` does not parse. */
export const joinPath = (
  path: string,
  ...segments: readonly PathSegment[]
): NormalizedPath | undefined => {
  const parsed = parsePath(path);
  return parsed.ok ? formatPath([...parsed.value, ...segments]) : undefined;
};
