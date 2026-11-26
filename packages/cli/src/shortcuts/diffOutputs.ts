// `nimbo diff`'s lines for a cell whose saved run changed (the file's `outputs`): the status when it
// changed, the value's changed paths (the first ten) and what the run printed, as `nimbo` prints cell.compare.
import type { OutputsChange, ValueChange } from "@jsnb/core";

type Paint = (code: string, text: string) => string;

const shown = (value: unknown): string => {
  const text = value === undefined ? "" : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
};

/** A changed value path: added in green, removed in red, changed as before → after. */
function valueLine(each: ValueChange, indent: string, paint: Paint): string {
  if (each.kind === "added") return paint("32", `${indent}+ ${each.path} ${shown(each.after)}`);
  if (each.kind === "removed") return paint("31", `${indent}- ${each.path} ${shown(each.before)}`);
  return `${indent}~ ${each.path} ${shown(each.before)} → ${shown(each.after)}`;
}

/** What the run printed, the changed lines only. */
const printedLines = (
  comparison: OutputsChange["comparison"],
  indent: string,
  paint: Paint,
): string[] =>
  comparison.text.flatMap((line) =>
    line.kind === "added"
      ? [paint("32", `${indent}+${line.text}`)]
      : line.kind === "removed"
        ? [paint("31", `${indent}-${line.text}`)]
        : [],
  );

/** The status line when it changed, a missing run read as "no saved run". */
function statusLines(change: OutputsChange, indent: string): string[] {
  const before = change.before ?? "no saved run";
  const after = change.after ?? "no saved run";
  return before === after ? [] : [`${indent}outputs ${before} → ${after}`];
}

/** The value's changed paths, the first ten, then how many more. */
function valueLines(change: OutputsChange, indent: string, paint: Paint): string[] {
  const value = change.comparison.value;
  const values = value?.changes ?? [];
  const lines = values.slice(0, 10).map((each) => valueLine(each, indent, paint));
  const more = Math.max(0, values.length - 10) + (value?.more ?? 0);
  if (more > 0) lines.push(`${indent}  and ${String(more)} more value changes`);
  return lines;
}

export function outputLines(change: OutputsChange, indent: string, paint: Paint): string[] {
  const { error } = change.comparison;
  return [
    ...statusLines(change, indent),
    ...valueLines(change, indent, paint),
    ...printedLines(change.comparison, indent, paint),
    ...(error.before === error.after
      ? []
      : [`${indent}error ${error.before ?? "none"} → ${error.after ?? "none"}`]),
  ];
}
