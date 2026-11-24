// The words of a run's error block: the short list of what Details holds, the text Copy error writes,
// and a syntax error's caret. The block's title is the error's name and message, as Jupyter prints them.
import type { ErrorInfo } from "@jsnb/core";

const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? "" : "s"}`;

/** At most this many of the error's data fields are named on the Details row. */
const named = 3;

/** One data field as the Details row says it: `code charge_already_refunded`, `cell 2` for a cell. */
function field([key, value]: readonly [string, unknown]): string | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
    return null;
  const text = String(value);
  if (text === "" || text.length > 48) return null;
  return key === "cell" ? text : `${key} ${text}`;
}

/** What Details holds, in a few words: up to three of its data's short fields and its stack's length,
 * `code charge_already_refunded, 7 stack frames` (the name is on the title line). */
export function detailsWords(error: ErrorInfo): string {
  const data = error.data ?? {};
  // a cell's place (`index`) beside the cell itself would say its number twice
  const skipped = new Set(["excerpt", "cause", ...("cell" in data ? ["index"] : [])]);
  const fields = Object.entries(data)
    .filter(([key]) => !skipped.has(key))
    .flatMap((entry) => field(entry) ?? [])
    .slice(0, named);
  const frames = error.frames.length === 0 ? [] : [plural(error.frames.length, "stack frame")];
  return [...fields, ...frames].join(", ");
}

/** The text Copy error writes: the stack as the user reads it, or the name and message when there is none. */
export const errorText = (error: ErrorInfo): string =>
  error.raw.trim() === "" ? `${error.name}: ${error.message}` : error.raw;

/** The line under a syntax error's quoted line: spaces up to its column, the line's own tabs kept, then a caret. */
export function caretLine(text: string, col: number): string {
  const at = Math.min(Math.max(col - 1, 0), text.length);
  return `${text.slice(0, at).replace(/[^\t]/gu, " ")}^`;
}
