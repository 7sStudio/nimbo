// Tests of size.ts: node counts, depth, characters and the longest name in one pass, with an early stop.
import { describe, expect, it } from "vitest";

import { chargeList } from "../fixtures/records.ts";
import type { Size } from "./size.ts";
import { measure } from "./size.ts";

const unlimited: Size = {
  nodes: Infinity,
  depth: Infinity,
  chars: Infinity,
  longestName: Infinity,
};

/** `depth` arrays nested in one another around a 1. */
const chain = (depth: number): unknown => {
  let value: unknown = 1;
  for (let level = 0; level < depth; level += 1) value = [value];
  return value;
};

describe("measure", () => {
  it.each<[unknown, Size]>([
    [1, { nodes: 1, depth: 0, chars: 0, longestName: 0 }],
    ["abc", { nodes: 1, depth: 0, chars: 3, longestName: 0 }],
    [null, { nodes: 1, depth: 0, chars: 0, longestName: 0 }],
    [[], { nodes: 1, depth: 0, chars: 0, longestName: 0 }],
    [{}, { nodes: 1, depth: 0, chars: 0, longestName: 0 }],
    [[1], { nodes: 2, depth: 1, chars: 0, longestName: 0 }],
    [[1, [2, 3], { a: null }], { nodes: 7, depth: 2, chars: 1, longestName: 1 }],
    [{ a: { bc: { def: [1, "xy"] } } }, { nodes: 6, depth: 4, chars: 8, longestName: 3 }],
  ])("measures %j as %j", (value, size) => {
    expect(measure(value, unlimited)).toEqual(size);
  });

  it("counts 5 + 11 nodes per charge in the fixture, 4 deep, and the characters of its names and strings", () => {
    const value = chargeList(900);
    const strings = JSON.stringify(value).match(/"[^"]*"/g) ?? [];
    expect(measure(value, unlimited)).toEqual({
      nodes: 9_905,
      depth: 4,
      chars: strings.join("").length - 2 * strings.length,
      longestName: 8,
    });
  });
});

describe("measure stops early", () => {
  it("soon after the node count passes its limit", () => {
    expect(measure(chargeList(9000), { ...unlimited, nodes: 100 }).nodes).toBe(101);
  });

  it("as soon as the depth passes its limit", () => {
    expect(measure(chain(64), { ...unlimited, depth: 64 })).toMatchObject({ nodes: 65, depth: 64 });
    expect(measure(chain(10_000), { ...unlimited, depth: 64 })).toMatchObject({
      nodes: 66,
      depth: 65,
    });
  });

  it("as soon as the characters pass their limit, long names included", () => {
    const value = { ["k".repeat(1_000_000)]: Array.from({ length: 10 }, () => "x".repeat(1000)) };
    expect(measure(value, { ...unlimited, chars: 1_000_500 })).toEqual({
      nodes: 3,
      depth: 2,
      chars: 1_001_000,
      longestName: 1_000_000,
    });
  });

  it("as soon as a member name passes its limit", () => {
    const value = [{ a: 1 }, { ["k".repeat(20_000)]: [1, 2, 3] }, { b: 2 }];
    expect(measure(value, { ...unlimited, longestName: 10_000 })).toMatchObject({
      longestName: 20_000,
    });
  });
});
