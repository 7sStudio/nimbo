// A finished run's duration as the Time column and the outline print it, in tabular figures.

/** "0.4 ms", "3.2 ms", "412 ms", "2.4 s". The kernel and the page time a run to a fraction of a millisecond, so a
 * run under 10 ms keeps one decimal rather than reading "0 ms", and one that rounds to nothing says "under 0.1 ms". */
export function durationText(ms: number): string {
  if (ms < 0.05) return "under 0.1 ms";
  if (ms < 9.95) return `${ms.toFixed(1)} ms`;
  return ms < 1000 ? `${String(Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;
}
