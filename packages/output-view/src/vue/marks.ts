// Text split at find's ranges, so a view can wrap each match in <mark> ("matches highlighted").
import type { TextRange } from "../model/matcher.js";

/** A run of text and where it starts in the whole: the offset is its stable key in a v-for. */
export type Segment = { readonly text: string; readonly mark: boolean; readonly start: number };

/** Runs of text with the offset each starts at, from `from`. */
export function withStarts<T extends { readonly text: string }>(
  runs: readonly T[],
  from = 0,
): (T & { readonly start: number })[] {
  let at = from;
  return runs.map((run) => {
    const start = at;
    at += run.text.length;
    return { ...run, start };
  });
}

/** The text in runs, `mark` on the ones a range covers; ranges are sorted and do not overlap (find's are). */
export function segments(text: string, ranges: readonly TextRange[]): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) out.push({ text: text.slice(at, start), mark: false, start: at });
    if (end > start) out.push({ text: text.slice(start, end), mark: true, start });
    at = Math.max(at, end);
  }
  if (at < text.length || out.length === 0)
    out.push({ text: text.slice(at), mark: false, start: at });
  return out;
}

/** A run of a string as it shows inside quotes: JSON escapes, without the quotes. */
export const escaped = (text: string): string => JSON.stringify(text).slice(1, -1);
