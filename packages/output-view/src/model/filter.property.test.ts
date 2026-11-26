// Property tests of filter.ts: chips survive the Filter text round trip, and no text makes the parser throw.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Chip } from "./chips.js";
import { formatFilter, parseFilter } from "./filter.js";
import { formatKey } from "./path.js";

const key = fc
  .array(fc.oneof(fc.string(), fc.nat({ max: 99 })), { minLength: 1, maxLength: 3 })
  .map(formatKey);
const literal = fc.oneof(
  fc.string(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
);

const chip: fc.Arbitrary<Chip> = fc.oneof(
  fc.record({
    key,
    op: fc.constantFrom(
      "=" as const,
      "!=" as const,
      ">" as const,
      "<" as const,
      ">=" as const,
      "<=" as const,
    ),
    value: literal,
  }),
  fc.record({
    key,
    op: fc.constantFrom("contains" as const, "startsWith" as const, "matches" as const),
    value: fc.string(),
  }),
  fc.record({ key, op: fc.constant("exists" as const) }),
);

describe("Filter text", () => {
  it("reads formatted chips back to the same chips", () => {
    fc.assert(
      fc.property(fc.array(chip, { maxLength: 4 }), (chips) => {
        expect(parseFilter(formatFilter(chips))).toEqual({ ok: true, value: chips });
      }),
      { numRuns: 50 },
    );
  });

  it("never throws on any text", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(typeof parseFilter(text).ok).toBe("boolean");
      }),
      { numRuns: 50 },
    );
  });
});
