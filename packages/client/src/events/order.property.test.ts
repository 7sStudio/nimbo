// Property tests of the ordering steps over random arrivals with drops, duplicates and reordering. 50 runs: whatever arrives, what is delivered is contiguous from the state's seq, in order, each seq once.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Ordering, Sequenced } from "./order.js";
import { buffering, receive, start } from "./order.js";

type Run = { readonly delivered: number[]; readonly gap: boolean };

/** Feeds `before` while hydrating, starts at `seq`, then feeds `after` live; stops at the first gap. */
function run(seq: number, before: readonly number[], after: readonly number[]): Run {
  const delivered: number[] = [];
  let ordering: Ordering<Sequenced> = buffering();
  for (const s of before) ordering = receive(ordering, { seq: s }).ordering;
  let step = start(ordering, seq);
  delivered.push(...step.deliver.map((event) => event.seq));
  for (const s of after) {
    if (step.gap) break;
    step = receive(step.ordering, { seq: s });
    delivered.push(...step.deliver.map((event) => event.seq));
  }
  return { delivered, gap: step.gap };
}

const arrival = fc.array(fc.nat({ max: 40 }), { maxLength: 40 });

describe("ordering", () => {
  it("delivers a contiguous run from seq + 1, each seq once, whatever arrives", () => {
    fc.assert(
      fc.property(fc.nat({ max: 20 }), arrival, arrival, (seq, before, after) => {
        const { delivered } = run(seq, before, after);
        delivered.forEach((s, index) => {
          expect(s).toBe(seq + 1 + index);
        });
        for (const s of delivered) expect([...before, ...after]).toContain(s);
      }),
      { numRuns: 50 },
    );
  });
});

describe("ordering of complete arrivals", () => {
  it("loses nothing and reports no gap when every seq arrives in order, duplicates and stale ones mixed in", () => {
    const scenario = fc
      .record({
        seq: fc.nat({ max: 20 }),
        count: fc.nat({ max: 30 }),
        split: fc.nat({ max: 30 }),
        noise: fc.array(fc.nat({ max: 60 }), { maxLength: 30 }),
      })
      .map(({ seq, count, split, noise }) => {
        const fresh = Array.from({ length: count }, (_, index) => seq + 1 + index);
        // Noise only repeats what already arrived (or is at or below seq), as a resent or stale event does.
        const arrivals = fresh.flatMap((s, index) => [
          s,
          ...noise.filter((n) => n % (index + 2) === 0 && n <= s),
        ]);
        return { seq, count, before: arrivals.slice(0, split), after: arrivals.slice(split) };
      });
    fc.assert(
      fc.property(scenario, ({ seq, count, before, after }) => {
        const result = run(seq, before, after);
        expect(result.gap).toBe(false);
        expect(result.delivered).toEqual(
          Array.from({ length: count }, (_, index) => seq + 1 + index),
        );
      }),
      { numRuns: 50 },
    );
  });
});

describe("ordering of incomplete arrivals", () => {
  it("reports a gap whenever a seq after the state never arrives but a later one does", () => {
    fc.assert(
      fc.property(fc.nat({ max: 20 }), fc.integer({ min: 2, max: 10 }), (seq, count) => {
        const missing = seq + 1 + Math.floor(count / 2);
        const arrivals = Array.from({ length: count }, (_, index) => seq + 1 + index).filter(
          (s) => s !== missing,
        );
        const result = run(seq, [], arrivals);
        expect(result.gap).toBe(missing < seq + count);
        expect(result.delivered).toEqual(arrivals.filter((s) => s < missing));
      }),
      { numRuns: 50 },
    );
  });
});
