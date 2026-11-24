// Large wire forms for the performance tests: the seeded Stripe events of 09-testing §8, encoded without budgets
// (the daemon keeps the full value, so the viewer meets values past the 256 KB slice), and a node counter.
import { encode } from "@jsnb/core";

import { stripeEvents } from "../../../../../fixtures/stripe-events.js";

/** The wire form of the first `count` events, encoded whole. */
export const eventsWire = (count: number): unknown =>
  encode(stripeEvents(count), {
    maxNodes: Number.POSITIVE_INFINITY,
    maxBytes: Number.POSITIVE_INFINITY,
  }).json;

/** Every node of a wire form, containers and leaves. */
export function countNodes(json: unknown): number {
  if (typeof json !== "object" || json === null) return 1;
  const children: unknown[] = Array.isArray(json) ? json : Object.values(json);
  return children.reduce<number>((sum, child) => sum + countNodes(child), 1);
}

/** The CPU time of this thread in ms: the test stage runs every suite in parallel under coverage, so wall time
 * measures the machine's load as much as the code (query-json's budgets do the same). */
const threadCpuMs = (): number => {
  const { user, system } = process.threadCpuUsage();
  return (user + system) / 1000;
};

const median = (samples: readonly number[]): number =>
  [...samples].sort((a, b) => a - b)[1] ?? Number.POSITIVE_INFINITY;

/** One warm-up run, then three timed runs: the median CPU time and the median wall time, in ms (09-testing §7). */
export function medianOfThree(run: () => unknown): { readonly cpu: number; readonly wall: number } {
  run();
  const samples = [0, 1, 2].map(() => {
    const cpu = threadCpuMs();
    const wall = performance.now();
    run();
    return { cpu: threadCpuMs() - cpu, wall: performance.now() - wall };
  });
  return { cpu: median(samples.map((s) => s.cpu)), wall: median(samples.map((s) => s.wall)) };
}

/** A budget with the 20 % tolerance of 09-testing §7. */
export const withTolerance = (budgetMs: number): number => budgetMs * 1.2;
