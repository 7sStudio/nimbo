// How a flag's text becomes an input value (03-api §8): numbers parsed, lists item by item, and a JSON key's text taken
// as JSON when it is JSON other than a string and fits the key's schema, else as the text itself; the command's
// schema has the last word.
import type { AnyCommand } from "@jsnb/core";

import type { Flag } from "./flags.js";

/** A number's text as a number, or the text when it is none, so the schema names the mistake. */
const numberOf = (text: string): unknown => {
  const value = Number(text);
  return text.trim() === "" || !Number.isFinite(value) ? text : value;
};

type Parsed = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

const jsonOf = (text: string): Parsed => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    // Not JSON: the text itself is the candidate (`--select all`, `--after c_a1b2c3`, a jq program).
    return { ok: false };
  }
};

/** Whether `value` at `key` passes the schema, whatever the other keys hold. */
function fits(command: AnyCommand, key: string, value: unknown): boolean {
  const result = command.input.safeParse({ [key]: value });
  return result.success || !result.error.issues.some((issue) => issue.path[0] === key);
}

/**
 * A JSON key's value: the parsed JSON when it is not a string and fits; else the text itself when it fits (a quoted jq
 * program `"x"` keeps its quotes); else a JSON string that fits; else the JSON (or the text), for the schema to name.
 */
function jsonValue(command: AnyCommand, key: string, text: string): unknown {
  const parsed = jsonOf(text);
  if (parsed.ok && typeof parsed.value !== "string" && fits(command, key, parsed.value))
    return parsed.value;
  if (fits(command, key, text)) return text;
  if (parsed.ok && fits(command, key, parsed.value)) return parsed.value;
  return parsed.ok ? parsed.value : text;
}

/** The input value of `flag` from what parseArgs read for it (a string, a boolean, or a list of strings). */
export function valueOf(
  command: AnyCommand,
  flag: Flag,
  raw: string | boolean | readonly (string | boolean)[],
): unknown {
  if (typeof raw === "boolean") return raw;
  if (typeof raw !== "string")
    return raw.map((item) => (flag.item === "number" ? numberOf(String(item)) : item));
  if (flag.kind === "number") return numberOf(raw);
  if (flag.kind === "json") return jsonValue(command, flag.key, raw);
  return raw;
}
