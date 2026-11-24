// The line diff behind an agent edit's review (03-api §5): the source before the first edit no one reviewed
// against the source now, as the lines kept, removed and added (a longest common subsequence of lines), the lines of
// the source now that an agent changed, and the hunks a card shows with a little context around each change.
import type { LineRange } from "../model/cell.js";

/** One line of a diff: kept (its number before and now), removed (its number before) or added (its number now). */
export type DiffLine =
  | {
      readonly kind: "same";
      readonly text: string;
      readonly before: number;
      readonly after: number;
    }
  | { readonly kind: "removed"; readonly text: string; readonly before: number }
  | { readonly kind: "added"; readonly text: string; readonly after: number };

/** Past this many line pairs in the part that differs, that part counts as replaced whole: a diff stays cheap. */
const pairLimit = 1_000_000;

const linesOf = (text: string): readonly string[] => text.split("\n");

/** lcs[i * (b.length + 1) + j]: the length of the longest common subsequence of a[i..] and b[j..]. */
function lcsTable(a: readonly string[], b: readonly string[]): Uint32Array {
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  const at = (i: number, j: number) => lcs[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i -= 1)
    for (let j = b.length - 1; j >= 0; j -= 1)
      lcs[i * width + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
  return lcs;
}

type Step = "same" | "removed" | "added";

/** The diff's step at a[i], b[j]: kept when they match, else the side whose next line keeps the longer common part. */
function stepAt(
  lcs: Uint32Array,
  sides: readonly [readonly string[], readonly string[]],
  i: number,
  j: number,
): Step {
  const [a, b] = sides;
  if (i >= a.length) return "added";
  if (j >= b.length) return "removed";
  if (a[i] === b[j]) return "same";
  const width = b.length + 1;
  return (lcs[(i + 1) * width + j] ?? 0) >= (lcs[i * width + j + 1] ?? 0) ? "removed" : "added";
}

/** The lines of `a` and `b` past their common start and end (`offset` lines), as a diff reads them. */
function middle(a: readonly string[], b: readonly string[], offset: number): DiffLine[] {
  const removed = (i: number): DiffLine => ({
    kind: "removed",
    text: a[i] ?? "",
    before: offset + i + 1,
  });
  const added = (j: number): DiffLine => ({
    kind: "added",
    text: b[j] ?? "",
    after: offset + j + 1,
  });
  if (a.length * b.length > pairLimit)
    return [...a.map((_, i) => removed(i)), ...b.map((_, j) => added(j))];
  const lcs = lcsTable(a, b);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const step = stepAt(lcs, [a, b], i, j);
    if (step === "same")
      out.push({ kind: "same", text: a[i] ?? "", before: offset + i + 1, after: offset + j + 1 });
    out.push(...(step === "removed" ? [removed(i)] : step === "added" ? [added(j)] : []));
    if (step !== "added") i += 1;
    if (step !== "removed") j += 1;
  }
  return out;
}

/** Every line of `before` and `after` as kept, removed or added; removed lines come before the lines added in their place. */
export function lineDiff(before: string, after: string): readonly DiffLine[] {
  const a = linesOf(before);
  const b = linesOf(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end += 1;
  const same = (i: number, j: number): DiffLine => ({
    kind: "same",
    text: a[i] ?? "",
    before: i + 1,
    after: j + 1,
  });
  return [
    ...a.slice(0, start).map((_, i) => same(i, i)),
    ...middle(a.slice(start, a.length - end), b.slice(start, b.length - end), start),
    ...Array.from({ length: end }, (_, k) => same(a.length - end + k, b.length - end + k)),
  ];
}

/** Sorted line numbers as ranges of consecutive lines. */
function rangesOf(lines: readonly number[]): readonly LineRange[] {
  const ranges: { from: number; to: number }[] = [];
  for (const line of [...new Set(lines)].sort((x, y) => x - y)) {
    const last = ranges.at(-1);
    if (last !== undefined && last.to + 1 === line) last.to = line;
    else ranges.push({ from: line, to: line });
  }
  return ranges;
}

/**
 * The lines of `after` an edit from `before` changed: every added line, and for lines removed with nothing added in
 * their place, the line that now follows the gap (the last line when they were removed at the end), so a deletion is
 * marked too. Empty when the two are the same.
 */
export function changedLines(before: string, after: string): readonly LineRange[] {
  const diff = lineDiff(before, after);
  const total = linesOf(after).length;
  const marked: number[] = [];
  let next = 1; // the line of `after` the next kept or added line has
  diff.forEach((line, at) => {
    if (line.kind !== "removed") {
      next = line.after + 1;
      if (line.kind === "added") marked.push(line.after);
      return;
    }
    const following = diff[at + 1];
    if (following === undefined || following.kind === "same") marked.push(Math.min(next, total));
  });
  return rangesOf(marked);
}

/** A run of a diff to show: changed lines with up to `context` kept lines on each side; a gap of kept lines between
 * two hunks is never shown twice. */
export type DiffHunk = readonly DiffLine[];

/** The hunks of `diff`, each change with up to `context` kept lines around it; none when nothing changed. */
export function diffHunks(diff: readonly DiffLine[], context: number): readonly DiffHunk[] {
  const changed = diff.flatMap((line, at) => (line.kind === "same" ? [] : [at]));
  const hunks: DiffLine[][] = [];
  let shownTo = -1;
  for (const at of changed) {
    const start = Math.max(at - context, 0);
    const to = Math.min(at + context, diff.length - 1);
    const last = hunks.at(-1);
    // a change whose context touches what the last hunk shows joins it
    if (last !== undefined && start <= shownTo + 1) last.push(...diff.slice(shownTo + 1, to + 1));
    else hunks.push(diff.slice(start, to + 1));
    shownTo = Math.max(shownTo, to);
  }
  return hunks;
}
