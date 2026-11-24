// fast-check arbitraries for Filter chips, shared by the chips' property tests (in the calling thread and in the worker).
import fc from "fast-check";

import type { Chip, ChipValue } from "../types.ts";

/** 50 runs per property. */
export const runs = { numRuns: 50 } as const;

/** Any short text, whole graphemes only. */
export const text = fc.string({ unit: "grapheme", maxLength: 8 });

const scalar: fc.Arbitrary<ChipValue> = fc.oneof(
  text,
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
  fc.constant(null),
);

const key = fc.oneof(
  fc.constantFrom(
    "status",
    "metadata.order_id",
    "items[0].price",
    "['first name']",
    "first name",
    "[1]",
  ),
  text,
);

/** A chip of any operator over the given keys, comparison values, texts and patterns. */
export const chipOf = (
  keys: fc.Arbitrary<string>,
  values: fc.Arbitrary<ChipValue>,
  texts: fc.Arbitrary<string>,
  patterns: fc.Arbitrary<string>,
): fc.Arbitrary<Chip> =>
  fc.oneof(
    fc.record({
      key: keys,
      op: fc.constantFrom("=", "!=", ">", "<", ">=", "<=" as const),
      value: values,
    }),
    fc.record({ key: keys, op: fc.constantFrom("contains", "startsWith" as const), value: texts }),
    fc.record({ key: keys, op: fc.constant("matches" as const), value: patterns }),
    fc.record({ key: keys, op: fc.constant("exists" as const) }),
  );

/** Up to four chips over any key, value and text. */
export const chipList = fc.array(chipOf(key, scalar, text, text), { maxLength: 4 });
