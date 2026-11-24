// The budget rule of 09-testing §7 for the performance tests: a warm-up, then three samples whose median counts, held
// to the budget with a 20 % tolerance; and the percentiles of a batch of runs.

/** A budget with the 20 % tolerance of 09-testing §7. */
export const withTolerance = (budgetMs: number): number => budgetMs * 1.2;

/** The `p` percentile (0 < p ≤ 1) of `samples`, nearest rank. */
export function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? Number.POSITIVE_INFINITY;
}

/** The median of `samples`. */
export const median = (samples: readonly number[]): number => percentile(samples, 0.5);

/** One warm-up run of `sample`, then three whose values are returned. */
export async function threeSamples<T>(sample: () => Promise<T>): Promise<readonly T[]> {
  await sample();
  const values: T[] = [];
  for (let index = 0; index < 3; index += 1) values.push(await sample());
  return values;
}
