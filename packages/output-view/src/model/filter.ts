// The Filter text the CLI passes as `--where` (`status = succeeded, amount > 1000`), read into chips and written back.
import type { Chip, ChipOp } from "./chips.js";
import { chipText, isTextOp, makeChip } from "./chips.js";
import { scanString } from "./path.js";

export type FilterError = { readonly message: string; readonly position: number };

export type FilterResult =
  | { readonly ok: true; readonly value: readonly Chip[] }
  | { readonly ok: false; readonly error: FilterError };

type Clause = { readonly text: string; readonly start: number };

const symbols: readonly (readonly [string, ChipOp])[] = [
  [">=", ">="],
  ["<=", "<="],
  ["!=", "!="],
  ["==", "="],
  ["=", "="],
  [">", ">"],
  ["<", "<"],
];
const words: readonly ChipOp[] = ["contains", "startsWith", "matches", "exists"];

const fail = (message: string, position: number): FilterResult => ({
  ok: false,
  error: { message, position },
});

/** Where a quoted run that starts at `at` ends (after its closing quote), skipping escapes; the text's end if open. */
function quotedEnd(text: string, at: number): number {
  const quote = text.charAt(at);
  for (let index = at + 1; index < text.length; index += 1) {
    if (text.charAt(index) === "\\") index += 1;
    else if (text.charAt(index) === quote) return index + 1;
  }
  return text.length;
}

/** Calls `visit` at every offset outside quotes and brackets, until it returns true; returns that offset or -1. */
function scanTopLevel(text: string, visit: (index: number) => boolean): number {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text.charAt(index);
    if (ch === "'" || ch === '"') index = quotedEnd(text, index) - 1;
    else if (ch === "[" || ch === "]") depth += ch === "[" ? 1 : -1;
    else if (depth === 0 && visit(index)) return index;
  }
  return -1;
}

function clauses(text: string): Clause[] {
  const out: Clause[] = [];
  let start = 0;
  scanTopLevel(text, (index) => {
    if (text.charAt(index) !== ",") return false;
    out.push({ text: text.slice(start, index), start });
    start = index + 1;
    return false;
  });
  return [...out, { text: text.slice(start), start }];
}

type Found = { readonly at: number; readonly length: number; readonly op: ChipOp };

/** The first operator outside quotes and brackets; a word operator needs blank space before it and after it. */
function findOperator(text: string): Found | undefined {
  let found: Found | undefined;
  scanTopLevel(text, (index) => {
    const symbol = symbols.find(([written]) => text.startsWith(written, index));
    const word = /\s/.test(text.charAt(index - 1))
      ? words.find((w) => text.startsWith(w, index) && !/\S/.test(text.charAt(index + w.length)))
      : undefined;
    if (symbol) found = { at: index, length: symbol[0].length, op: symbol[1] };
    else if (word) found = { at: index, length: word.length, op: word };
    return found !== undefined;
  });
  return found;
}

type Value = { readonly value: string; readonly quoted: boolean };

/** The value after the operator: a quoted JSON-style string, or the bare text up to the comma. */
function readValue(op: ChipOp, rest: string, position: number): Value | FilterError {
  if (rest.startsWith('"') || rest.startsWith("'")) {
    const quoted = scanString(rest, 0);
    if (quoted?.end === rest.length) return { value: quoted.value, quoted: true };
    const message = `The quoted value at position ${String(position)} is not closed, or text follows it.`;
    return { message, position };
  }
  if (rest !== "") return { value: rest, quoted: false };
  return { message: `A value is missing after "${op}" at position ${String(position)}.`, position };
}

/** A quoted value stays a string even when it reads like a number or a keyword. */
function quotedChip(key: string, op: ChipOp, value: string): Chip {
  const chip = makeChip(key, op, value);
  return chip.op === "exists" || isTextOp(chip.op) ? chip : { key: chip.key, op: chip.op, value };
}

function chipFrom(key: string, op: ChipOp, rest: string, valueAt: number): Chip | FilterError {
  if (op === "exists") {
    if (rest === "") return makeChip(key, op);
    return { message: `"exists" takes no value; remove "${rest}".`, position: valueAt };
  }
  const value = readValue(op, rest, valueAt);
  if ("message" in value) return value;
  return value.quoted ? quotedChip(key, op, value.value) : makeChip(key, op, value.value);
}

function parseClause(clause: Clause): Chip | FilterError {
  const found = findOperator(clause.text);
  if (found === undefined) {
    const message = `No operator in "${clause.text.trim()}"; use =, !=, >, <, >=, <=, contains, startsWith, matches or exists.`;
    return { message, position: clause.start };
  }
  const where = clause.start + found.at;
  const key = clause.text.slice(0, found.at).trim();
  if (key === "") {
    return {
      message: `A key is missing before "${found.op}" at position ${String(where)}.`,
      position: where,
    };
  }
  const rest = clause.text.slice(found.at + found.length).trim();
  return chipFrom(key, found.op, rest, where + found.length + 1);
}

/**
 * Reads the Filter text: clauses separated by commas, each `key op value` (`exists` takes no value); keys are relative
 * paths (`metadata.plan`, `['first name']`); values are JSON numbers, `true`, `false`, `null`, quoted strings, or bare
 * text up to the next comma. Blank text is no chips.
 */
export function parseFilter(text: string): FilterResult {
  if (text.trim() === "") return { ok: true, value: [] };
  const chips: Chip[] = [];
  for (const clause of clauses(text)) {
    if (clause.text.trim() === "")
      return fail(
        `An empty condition at position ${String(clause.start)}; remove the extra comma.`,
        clause.start,
      );
    const parsed = parseClause(clause);
    if ("message" in parsed) return { ok: false, error: parsed };
    chips.push(parsed);
  }
  return { ok: true, value: chips };
}

/** The Filter text of chips, `status = succeeded, amount > 1000`; parseFilter reads it back to the same chips. */
export const formatFilter = (chips: readonly Chip[]): string => chips.map(chipText).join(", ");
