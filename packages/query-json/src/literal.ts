// JSONPath string literals (RFC 9535 §2.3.1.1): reading either quote with escapes, writing the normalized form.

/** A value read from `text`, and the offset just after it. */
export type Scan<T> = { readonly value: T; readonly end: number };

const shortEscapes = new Map([
  ["b", "\b"],
  ["f", "\f"],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
  ["/", "/"],
  ["\\", "\\"],
]);

const hex4 = /[0-9a-fA-F]{4}/y;

const scanHex4 = (text: string, at: number): Scan<number> | undefined => {
  hex4.lastIndex = at;
  return hex4.test(text) ? { value: parseInt(text.slice(at, at + 4), 16), end: at + 4 } : undefined;
};

const isHigh = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

/** `\uXXXX`, where a high surrogate must be followed by `\u` and a low surrogate. */
const scanUnicode = (text: string, at: number): Scan<string> | undefined => {
  const first = scanHex4(text, at);
  if (first === undefined || isLow(first.value)) return undefined;
  if (!isHigh(first.value)) return { value: String.fromCharCode(first.value), end: first.end };
  const second = text.startsWith("\\u", first.end) ? scanHex4(text, first.end + 2) : undefined;
  if (second === undefined || !isLow(second.value)) return undefined;
  return { value: String.fromCharCode(first.value, second.value), end: second.end };
};

const scanEscape = (text: string, at: number, quote: string): Scan<string> | undefined => {
  const ch = text.charAt(at);
  if (ch === quote) return { value: quote, end: at + 1 };
  if (ch === "u") return scanUnicode(text, at + 1);
  const short = shortEscapes.get(ch);
  return short === undefined ? undefined : { value: short, end: at + 1 };
};

/** Reads a single- or double-quoted string literal starting at `at`; undefined when there is none. */
export const scanString = (text: string, at: number): Scan<string> | undefined => {
  const quote = text.charAt(at);
  if (quote !== "'" && quote !== '"') return undefined;
  let value = "";
  let index = at + 1;
  while (index < text.length) {
    const ch = text.charAt(index);
    if (ch === quote) return { value, end: index + 1 };
    if (ch < " ") return undefined;
    const escape = ch === "\\" ? scanEscape(text, index + 1, quote) : { value: ch, end: index + 1 };
    if (escape === undefined) return undefined;
    value += escape.value;
    index = escape.end;
  }
  return undefined;
};

const normalEscapes = new Map([
  ["\b", "\\b"],
  ["\f", "\\f"],
  ["\n", "\\n"],
  ["\r", "\\r"],
  ["\t", "\\t"],
  ["'", "\\'"],
  ["\\", "\\\\"],
]);

const escapeChar = (ch: string): string =>
  normalEscapes.get(ch) ?? (ch < " " ? `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}` : ch);

/** A name as a single-quoted literal with normalized-path escaping (RFC 9535 §2.7). */
export const quoteName = (name: string): string => `'${Array.from(name, escapeChar).join("")}'`;
