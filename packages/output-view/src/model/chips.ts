// Filter-mode chips (11-query §2): `key op value` clauses the bar renders and edits; the host's
// compiler (query-json's chipsToJsonPath) turns them into JSONPath. The operators are core's ChipOp; the chip itself is
// core's Chip narrowed so a text op always carries a string and `exists` carries no value.
import type { ChipOp, Path } from "@jsnb/core";

import { formatKey, parseKey } from "./path.js";

export type ChipValue = string | number | boolean | null;
export type { ChipOp };
export type TextOp = Extract<ChipOp, "contains" | "startsWith" | "matches">;
export type ComparisonOp = Exclude<ChipOp, TextOp | "exists">;

/** One condition on the filtered node's children; `key` is a relative singular path (`metadata.order_id`). */
export type Chip =
  | { readonly key: string; readonly op: ComparisonOp; readonly value: ChipValue }
  | { readonly key: string; readonly op: TextOp; readonly value: string }
  | { readonly key: string; readonly op: "exists" };

/** The ten operators, in the order the bar offers them. */
export const chipOps: readonly ChipOp[] = [
  "=",
  "!=",
  ">",
  "<",
  ">=",
  "<=",
  "contains",
  "startsWith",
  "exists",
  "matches",
];

const textOps: ReadonlySet<ChipOp> = new Set(["contains", "startsWith", "matches"]);

/** Whether an operator compares text (its value is always a string). */
export const isTextOp = (op: ChipOp): op is TextOp => textOps.has(op);

const jsonNumber = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?$/;

/** A typed literal from what the user wrote: a JSON number, `true`, `false`, `null`, else the text itself. */
export function literalOf(text: string): ChipValue {
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  const number = Number(text);
  return jsonNumber.test(text) && Number.isFinite(number) ? number : text;
}

/** A key with `$.` or `@.` in front reads as the same relative path. */
const relative = (key: string): string => key.replace(/^[$@](?=[.[])/, "").replace(/^\./, "");

/** The segments a key names: the key as a relative singular path, else the whole key as one member name. */
export function keyPath(key: string): Path {
  const text = relative(key);
  return parseKey(text) ?? [text];
}

/** The canonical form of a key: `metadata.order_id`, `['first name']`, `items[0]`. */
export const chipKey = (key: string): string => formatKey(keyPath(key));

/** A chip from the bar's three fields: the value typed by `literalOf` for comparisons, kept as text for text ops. */
export function makeChip(key: string, op: ChipOp, text = ""): Chip {
  const canonical = chipKey(key);
  if (op === "exists") return { key: canonical, op };
  if (isTextOp(op)) return { key: canonical, op, value: text };
  return { key: canonical, op, value: literalOf(text) };
}

const bareSafe = /^[^\s,'"[\]\p{Cc}][^,'"[\]\p{Cc}]*$/u;

/** A value as the Filter text writes it: bare when it reads back as itself, else a JSON literal. */
function chipValueText(chip: Chip): string {
  if (chip.op === "exists") return "";
  const value = chip.value;
  if (typeof value === "number" && Object.is(value, -0)) return "-0";
  if (typeof value !== "string") return String(value);
  const bare = bareSafe.test(value) && value.trimEnd() === value;
  return bare && (isTextOp(chip.op) || literalOf(value) === value) ? value : JSON.stringify(value);
}

/** One clause of the Filter text: `status = succeeded`, `amount > 1000`, `metadata.plan exists`. */
export function chipText(chip: Chip): string {
  const head = `${chipKey(chip.key)} ${chip.op}`;
  return chip.op === "exists" ? head : `${head} ${chipValueText(chip)}`;
}

/**
 * The chip a grid column filter adds (11-query §4): equality on a numeric column when the text is a number,
 * `contains` otherwise.
 */
export function columnChip(column: string | number, text: string, numeric: boolean): Chip {
  const key = formatKey([column]);
  const value = literalOf(text.trim());
  return numeric && typeof value === "number"
    ? { key, op: "=", value }
    : { key, op: "contains", value: text };
}
