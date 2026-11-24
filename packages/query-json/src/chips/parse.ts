// Filter mode backwards: a JSONPath query chips could have produced → those chips, so a generated or hand-typed query
// can be edited as chips again (11-query §2). Anything else (||, !, nesting, other functions) is not chips.
import { maxQueryLength } from "../engine.ts";
import type { Scan } from "../literal.ts";
import { scanString } from "../literal.ts";
import type { PathSegment } from "../paths.ts";
import { scanSegments } from "../paths.ts";
import { formatKey, shorthand } from "./key.ts";
import { unescapeLiteral } from "./regex.ts";
import type { Chip, ChipFilter, ChipValue } from "./types.ts";

const blank = /[ \t\n\r]*/y;
const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?/y;
const keywords: readonly (readonly [string, ChipValue])[] = [
  ["true", true],
  ["false", false],
  ["null", null],
];
const operators = [
  ["==", "="],
  ["!=", "!="],
  ["<=", "<="],
  [">=", ">="],
  ["<", "<"],
  [">", ">"],
] as const;

/** The offset after any blank space at `at` (RFC 9535 S). */
const skip = (text: string, at: number): number => {
  blank.lastIndex = at;
  blank.exec(text);
  return blank.lastIndex;
};

/** The offset after `word`, allowing blank space before it. */
const token = (text: string, at: number, word: string): number | undefined => {
  const start = skip(text, at);
  return text.startsWith(word, start) ? start + word.length : undefined;
};

const scanLiteral = (text: string, at: number): Scan<ChipValue> | undefined => {
  const start = skip(text, at);
  const string = scanString(text, start);
  if (string) return string;
  number.lastIndex = start;
  const digits = number.exec(text);
  if (digits) {
    const value = Number(digits[0]);
    return Number.isFinite(value) ? { value, end: number.lastIndex } : undefined;
  }
  const keyword = keywords.find(([word]) => text.startsWith(word, start));
  return keyword && { value: keyword[1], end: start + keyword[0].length };
};

/** `@` and at least one singular segment. */
const scanNode = (text: string, at: number): Scan<readonly PathSegment[]> | undefined => {
  const start = skip(text, at);
  if (text.charAt(start) !== "@") return undefined;
  const path = scanSegments(text, start + 1);
  return path.value.length > 0 ? path : undefined;
};

const patternChip = (name: string, key: string, pattern: string): Chip | undefined => {
  if (name === "match") return { key, op: "matches", value: pattern };
  const anchored = pattern.startsWith("^");
  const value = unescapeLiteral(anchored ? pattern.slice(1) : pattern);
  if (value === undefined) return undefined;
  return { key, op: anchored ? "startsWith" : "contains", value };
};

/** `search(@.key, "pattern")` or `match(@.key, "pattern")`. */
const scanFunction = (text: string, at: number, name: string): Scan<Chip> | undefined => {
  const open = token(text, at, `${name}(`);
  const node = open === undefined ? undefined : scanNode(text, open);
  const comma = node && token(text, node.end, ",");
  const pattern = comma === undefined ? undefined : scanString(text, skip(text, comma));
  const close = pattern && token(text, pattern.end, ")");
  if (node === undefined || pattern === undefined || close === undefined) return undefined;
  const chip = patternChip(name, formatKey(node.value), pattern.value);
  return chip && { value: chip, end: close };
};

/** `@.key op literal`, or `@.key` alone (exists). */
const scanTest = (text: string, at: number): Scan<Chip> | undefined => {
  const node = scanNode(text, at);
  if (node === undefined) return undefined;
  const key = formatKey(node.value);
  const start = skip(text, node.end);
  const operator = operators.find(([written]) => text.startsWith(written, start));
  if (operator === undefined) return { value: { key, op: "exists" }, end: node.end };
  const value = scanLiteral(text, start + operator[0].length);
  return value && { value: { key, op: operator[1], value: value.value }, end: value.end };
};

const scanChips = (text: string, at: number): Scan<readonly Chip[]> | undefined => {
  const chips: Chip[] = [];
  for (let start = at; ;) {
    const chip =
      scanFunction(text, start, "search") ??
      scanFunction(text, start, "match") ??
      scanTest(text, start);
    if (chip === undefined) return undefined;
    chips.push(chip.value);
    const and = token(text, chip.end, "&&");
    if (and === undefined) return { value: chips, end: chip.end };
    start = and;
  }
};

/** `*` (no chips) or `?` and chips joined by `&&`. */
const scanSelection = (text: string, at: number): Scan<readonly Chip[]> | undefined => {
  const star = token(text, at, "*");
  if (star !== undefined) return { value: [], end: star };
  const question = token(text, at, "?");
  return question === undefined ? undefined : scanChips(text, question);
};

/** The chips and filtered node of a query chipsToJsonPath could have produced; undefined for any other query. */
export const jsonPathToChips = (query: string): ChipFilter | undefined => {
  if (!query.startsWith("$") || query.length > maxQueryLength) return undefined;
  const prefix = scanSegments(query, 1);
  const open = token(query, prefix.end, "[");
  const selection = open === undefined ? undefined : scanSelection(query, open);
  const close = selection && token(query, selection.end, "]");
  if (selection === undefined || close !== query.length) return undefined;
  return { at: `$${shorthand(prefix.value)}`, chips: selection.value };
};
