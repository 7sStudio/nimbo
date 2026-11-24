// A text's changes for the Source Control view: the line diff an agent edit's review uses
// (analysis/lineDiff.ts) as hunks with three kept lines around each change, and the lines added and removed; and the
// keys that differ between two records (a cell's meta, a notebook's header), whatever their keys' order.
import { diffHunks, lineDiff } from "../analysis/lineDiff.js";
import type { KeyChange, TextDiff } from "../model/gitDiff.js";

/** Kept lines shown around each change. */
const context = 3;

/** A text's lines; "" has none. */
export const linesOf = (text: string): readonly string[] => (text === "" ? [] : text.split("\n"));

/** A whole text's lines, its final newline ending the last line rather than starting an empty one. */
const wholeLines = (text: string): readonly string[] =>
  linesOf(text.endsWith("\n") ? text.slice(0, -1) : text);

/** Two texts that both end in a newline (files): it ends their last lines, as git reads them. */
const bothEnded = (from: string, to: string): boolean => from.endsWith("\n") && to.endsWith("\n");

/** The changes from `before` to `after` (null: no text on that side): hunks and the lines added and removed. */
export function textDiff(before: string | null, after: string | null): TextDiff {
  const from = before ?? "";
  const to = after ?? "";
  const lines =
    from === ""
      ? wholeLines(to).map((text, at) => ({ kind: "added" as const, text, after: at + 1 }))
      : to === ""
        ? wholeLines(from).map((text, at) => ({ kind: "removed" as const, text, before: at + 1 }))
        : bothEnded(from, to)
          ? lineDiff(from.slice(0, -1), to.slice(0, -1))
          : lineDiff(from, to);
  return {
    hunks: diffHunks(lines, context),
    added: lines.filter((line) => line.kind === "added").length,
    removed: lines.filter((line) => line.kind === "removed").length,
  };
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A value written with sorted keys, so two values compare alike whatever their keys' order. */
function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => byText(a, b));
    const inner = entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`);
    return `{${inner.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The keys whose values differ between two records, in sorted order. */
export function keyChanges(
  from: Readonly<Record<string, unknown>>,
  to: Readonly<Record<string, unknown>>,
): readonly KeyChange[] {
  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort(byText);
  return keys.flatMap((key) => {
    const a = from[key];
    const b = to[key];
    if (canonical(a) === canonical(b)) return [];
    return [
      { key, ...(a === undefined ? {} : { from: a }), ...(b === undefined ? {} : { to: b }) },
    ];
  });
}
