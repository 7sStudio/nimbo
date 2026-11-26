// The property tests' oracle: chips evaluated directly on one record with RFC 9535's comparison rules,
// written without JSONPath so the engine's answer can be checked against it.
import type { PathSegment } from "../../paths.ts";
import { keySegments } from "../key.ts";
import type { Chip, ChipValue } from "../types.ts";

/** A node the key does not reach; it equals nothing and is ordered with nothing. */
const missing = Symbol("missing");

const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const child = (node: unknown, segment: PathSegment): unknown => {
  if (typeof segment === "number")
    return isList(node) && segment < node.length ? node[segment] : missing;
  return isObject(node) && Object.hasOwn(node, segment) ? node[segment] : missing;
};

const lookup = (record: unknown, key: string): unknown =>
  keySegments(key).reduce<unknown>(
    (node, segment) => (node === missing ? missing : child(node, segment)),
    record,
  );

/** Literals are scalars, so equality is same type and same value. */
const equals = (found: unknown, value: ChipValue): boolean =>
  typeof found === typeof value && found === value;

const codePoints = (text: string): number[] => Array.from(text, (ch) => ch.codePointAt(0) ?? 0);

/** Numbers by value, strings by Unicode scalar values; anything else is not ordered. */
const less = (left: unknown, right: unknown): boolean => {
  if (typeof left === "number" && typeof right === "number") return left < right;
  if (typeof left !== "string" || typeof right !== "string") return false;
  const [a, b] = [codePoints(left), codePoints(right)];
  const differ = a.findIndex((point, index) => point !== b[index]);
  if (differ === -1) return a.length < b.length;
  return differ < b.length && (a[differ] ?? 0) < (b[differ] ?? 0);
};

const comparisons = {
  "=": (found: unknown, value: ChipValue) => equals(found, value),
  "!=": (found: unknown, value: ChipValue) => !equals(found, value),
  "<": (found: unknown, value: ChipValue) => less(found, value),
  "<=": (found: unknown, value: ChipValue) => less(found, value) || equals(found, value),
  ">": (found: unknown, value: ChipValue) => less(value, found),
  ">=": (found: unknown, value: ChipValue) => less(value, found) || equals(found, value),
} as const;

/** I-Regexp's `.` is any character but a line break; the pool's patterns use no other construct that differs. */
const fullMatch = (text: string, pattern: string): boolean =>
  new RegExp(`^(?:${pattern.replaceAll(".", "[^\\n\\r]")})$`, "u").test(text);

const matchText = (
  text: string,
  op: "contains" | "startsWith" | "matches",
  value: string,
): boolean =>
  op === "contains"
    ? text.includes(value)
    : op === "startsWith"
      ? text.startsWith(value)
      : fullMatch(text, value);

/** Whether a record satisfies one chip. */
export const holds = (chip: Chip, record: unknown): boolean => {
  const found = lookup(record, chip.key);
  switch (chip.op) {
    case "exists":
      return found !== missing;
    case "contains":
    case "startsWith":
    case "matches":
      return typeof found === "string" && matchText(found, chip.op, chip.value);
    default:
      return comparisons[chip.op](found, chip.value);
  }
};
