// Which cells of two notebooks are the same cell, in nbdime's order of matching: by id (the
// format keeps ids stable), then same type and identical source (an id regenerated), then same type and a line
// similarity of at least 0.6, greedily in order, not tried past 200 unmatched cells a side. Then the moves: the
// longest run of matched cells that kept their order stays in place, every other matched cell moved.
import { lineDiff } from "../analysis/lineDiff.js";
import type { DocumentCell } from "../format/schema.js";
import { linesOf } from "./textDiff.js";

const similarEnough = 0.6;
const similarityLimit = 200;

/** How alike two sources are, 0 to 1: twice the kept lines over all lines. */
function similarity(a: string, b: string): number {
  const total = linesOf(a).length + linesOf(b).length;
  if (total === 0) return 1;
  const kept = lineDiff(a, b).filter((line) => line.kind === "same").length;
  return (2 * kept) / total;
}

type Pairing = {
  /** New index to old index. */
  readonly pairs: Map<number, number>;
  readonly usedOld: Set<number>;
};

const pair = (state: Pairing, fresh: number, old: number): void => {
  state.pairs.set(fresh, old);
  state.usedOld.add(old);
};
const leftOld = (state: Pairing, a: readonly DocumentCell[]) =>
  a.flatMap((_, at) => (state.usedOld.has(at) ? [] : [at]));
const leftNew = (state: Pairing, b: readonly DocumentCell[]) =>
  b.flatMap((_, at) => (state.pairs.has(at) ? [] : [at]));

/** The unmatched old cell most like `cell` (same type, similar enough), or undefined. */
function mostLike(
  state: Pairing,
  a: readonly DocumentCell[],
  cell: DocumentCell,
): number | undefined {
  let best: { readonly at: number; readonly score: number } | undefined;
  for (const old of leftOld(state, a)) {
    const other = a[old];
    if (other?.type !== cell.type) continue;
    const score = similarity(other.source, cell.source);
    if (score >= similarEnough && score > (best?.score ?? -1)) best = { at: old, score };
  }
  return best?.at;
}

/** New index to old index for every pair of cells that are the same cell. */
export function matchCells(
  a: readonly DocumentCell[],
  b: readonly DocumentCell[],
): ReadonlyMap<number, number> {
  const state: Pairing = { pairs: new Map(), usedOld: new Set() };
  const oldById = new Map(a.map((cell, at) => [cell.id, at]));
  b.forEach((cell, at) => {
    const old = oldById.get(cell.id);
    if (old !== undefined) pair(state, at, old);
  });
  for (const fresh of leftNew(state, b)) {
    const cell = b[fresh];
    const same = leftOld(state, a).find(
      (at) => a[at]?.type === cell?.type && a[at]?.source === cell?.source,
    );
    if (same !== undefined) pair(state, fresh, same);
  }
  const news = leftNew(state, b);
  if (news.length > similarityLimit || leftOld(state, a).length > similarityLimit)
    return state.pairs;
  for (const fresh of news) {
    const cell = b[fresh];
    const old = cell === undefined ? undefined : mostLike(state, a, cell);
    if (old !== undefined) pair(state, fresh, old);
  }
  return state.pairs;
}

/** The positions (into `values`) of one longest strictly increasing subsequence. */
export function longestIncreasing(values: readonly number[]): ReadonlySet<number> {
  const tails: number[] = []; // tails[k]: where the smallest tail of an increasing run of length k + 1 is
  const previous: number[] = [];
  values.forEach((value, at) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((values[tails[mid] ?? 0] ?? 0) < value) low = mid + 1;
      else high = mid;
    }
    previous[at] = low > 0 ? (tails[low - 1] ?? -1) : -1;
    tails[low] = at;
  });
  const kept = new Set<number>();
  for (let at = tails.at(-1) ?? -1; at !== -1; at = previous[at] ?? -1) kept.add(at);
  return kept;
}
