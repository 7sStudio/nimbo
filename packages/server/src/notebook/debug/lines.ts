// Where a breakpoint's line goes when its cell's code changes: the lines both versions keep (their longest common
// subsequence) carry it to their new place; a changed line keeps its place in the block that replaced it; a removed
// line's goes to the next kept line, or the last line.

/** Above this many line pairs the lines map by their offset from the end, which keeps edits at the top right. */
const maxPairs = 4_000_000;

type Kept = (number | undefined)[];

/** Old line (1-based) → new line by the offset from the end, for texts too long to compare. */
function shifted(n: number, m: number): Kept {
  const kept: Kept = [];
  for (let line = 1; line <= n; line += 1) {
    const to = line + m - n;
    kept[line] = to >= 1 && to <= m ? to : undefined;
  }
  return kept;
}

/** lengths[i][j]: the length of the longest common subsequence of before[i..] and after[j..]. */
function lcsTable(before: readonly string[], after: readonly string[]): Uint32Array[] {
  const lengths = Array.from(
    { length: before.length + 1 },
    () => new Uint32Array(after.length + 1),
  );
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const row = lengths[i] ?? new Uint32Array();
    const below = lengths[i + 1] ?? new Uint32Array();
    for (let j = after.length - 1; j >= 0; j -= 1)
      row[j] =
        before[i] === after[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
  }
  return lengths;
}

/** For each old line (1-based index), its line in `after`, or undefined when it was not kept. */
function keptLines(before: readonly string[], after: readonly string[]): Kept {
  if (before.length * after.length > maxPairs) return shifted(before.length, after.length);
  const lengths = lcsTable(before, after);
  const kept: Kept = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      kept[i + 1] = j + 1;
      i += 1;
      j += 1;
    } else if ((lengths[i + 1]?.[j] ?? 0) >= (lengths[i]?.[j + 1] ?? 0)) i += 1;
    else j += 1;
  }
  return kept;
}

/** The nearest kept line before `line` (its old and new number), or 0 and 0. */
function keptBefore(kept: Kept, line: number): { readonly at: number; readonly to: number } {
  for (let at = line - 1; at >= 1; at -= 1) {
    const to = kept[at];
    if (to !== undefined) return { at, to };
  }
  return { at: 0, to: 0 };
}

/** The new number of the nearest kept line after `line`, or one past the new text's end. */
function keptAfter(kept: Kept, line: number, end: number): number {
  for (let at = line + 1; at < kept.length; at += 1) {
    const to = kept[at];
    if (to !== undefined) return to;
  }
  return end + 1;
}

/** Maps 1-based `lines` of `before` to lines of `after`. */
export function mapLines(before: string, after: string, lines: readonly number[]): number[] {
  const next = after.split("\n");
  const kept = keptLines(before.split("\n"), next);
  return lines.map((line) => {
    const same = kept[line];
    if (same !== undefined) return same;
    const previous = keptBefore(kept, line);
    const following = keptAfter(kept, line, next.length);
    const inBlock = previous.to + (line - previous.at);
    return Math.max(1, Math.min(inBlock < following ? inBlock : following, next.length));
  });
}
