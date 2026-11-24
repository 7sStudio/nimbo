// The budget rule of 09-testing §7 for the performance tests: three samples whose median counts, held to the budget
// with a 20 % tolerance; the percentiles of a batch; and the figures written to stderr with the load average, since a
// figure taken while other pipelines run must say so.
import { loadavg } from "node:os";

/** A budget with the 20 % tolerance of 09-testing §7. */
export const withTolerance = (budgetMs: number): number => budgetMs * 1.2;

/** The `p` percentile (0 < p ≤ 1) of `samples`, nearest rank. */
export function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? Number.POSITIVE_INFINITY;
}

/** The median of `samples`. */
export const median = (samples: readonly number[]): number => percentile(samples, 0.5);

/** Three samples of `sample`, one after the other. */
export async function threeSamples<T>(sample: () => Promise<T>): Promise<readonly T[]> {
  const values: T[] = [];
  for (let index = 0; index < 3; index += 1) values.push(await sample());
  return values;
}

/** Writes one budget's figures and the load average as a JSON line on stderr. */
export function report(budget: string, figures: Readonly<Record<string, unknown>>): void {
  const load = loadavg().map((value) => Math.round(value * 100) / 100);
  process.stderr.write(`${JSON.stringify({ budget, ...figures, load })}\n`);
}
