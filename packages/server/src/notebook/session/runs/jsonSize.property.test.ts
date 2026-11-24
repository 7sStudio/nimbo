// The JSON size walk against what it stands for: for any JSON value, and for the values JSON.stringify
// writes in its own way (undefined, functions and symbols left out or written null, non-finite numbers, toJSON), its
// size is Buffer.byteLength(JSON.stringify(value)), whatever slices it is walked in; a BigInt or a cycle throws.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { jsonSizer } from "./jsonSize.js";

/** The size a sizer reaches when stopped after every slice of `count` steps or less (a deadline already past). */
function sizeOf(value: unknown, sliced: boolean): number {
  const sizer = jsonSizer(value);
  while (!sizer.step(sliced ? 0 : Number.POSITIVE_INFINITY)) {
    // a past deadline: the walk stops every 256 steps and goes on at the next call
  }
  return sizer.bytes();
}

/** JSON.stringify as it behaves: no text (undefined) for undefined, a function or a symbol. */
const jsonText = (value: unknown): string | undefined => JSON.stringify(value);

const expected = (value: unknown): number => Buffer.byteLength(jsonText(value) ?? "null");

describe("jsonSizer", () => {
  it("measures any JSON value as Buffer.byteLength(JSON.stringify(value)), in one go or in slices", () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 4 }), fc.boolean(), (value, sliced) => {
        expect(sizeOf(value, sliced)).toBe(expected(value));
      }),
      { numRuns: 50 },
    );
  });

  it("writes what JSON.stringify writes for values JSON has no text for", () => {
    const odd = [
      undefined,
      () => 1,
      [undefined, () => 1, Symbol("s"), Number.NaN, -0, Infinity, 1e21],
      { a: undefined, b: () => 1, c: Symbol("s"), d: 'é😀\u0000"\\', "k\n": 2 },
      { toJSON: () => ({ replaced: true }) },
      new Date(0),
      Array.from({ length: 1000 }, (_, at) => ({ at, text: "x".repeat(at % 50) })),
    ];
    for (const value of odd) expect([value, sizeOf(value, true)]).toEqual([value, expected(value)]);
  });

  it("throws on a BigInt and on a cycle, as JSON.stringify does, but not on a value met twice", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => sizeOf({ n: 1n }, false)).toThrow(TypeError);
    expect(() => sizeOf(cycle, false)).toThrow(TypeError);
    const shared = { a: 1 };
    expect(sizeOf([shared, shared], false)).toBe(expected([shared, shared]));
  });
});
