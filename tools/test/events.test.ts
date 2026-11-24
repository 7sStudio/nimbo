// Tests until: resolves on the first match, rejects on exhaustion and on timeout, without sleeping.
import { describe, expect, it } from "vitest";

import { until } from "./events.js";

async function* numbers(...values: readonly number[]): AsyncGenerator<number> {
  for (const value of values) {
    await Promise.resolve();
    yield value;
  }
}

/** An iterable that never yields, to exercise the timeout. */
const never: AsyncIterable<number> = {
  [Symbol.asyncIterator]: () => ({
    next: () => new Promise<IteratorResult<number>>(() => undefined),
  }),
};

describe("until", () => {
  it("resolves with the first value the predicate accepts", async () => {
    await expect(until(numbers(1, 2, 3, 4), (n) => n > 2, { timeoutMs: 1000 })).resolves.toBe(3);
  });

  it("rejects when the iterable ends without a match", async () => {
    await expect(until(numbers(1, 2), (n) => n > 2, { timeoutMs: 1000 })).rejects.toThrow(
      "ended without a matching event",
    );
  });

  it("rejects after timeoutMs when nothing arrives", async () => {
    await expect(until(never, () => true, { timeoutMs: 1 })).rejects.toThrow("within 1 ms");
  });
});
