// Random wire forms for the property tests: plain JSON, every marker of core's form.ts, and malformed markers too.
import fc from "fast-check";

const markerTypes = [
  "undefined",
  "number",
  "bigint",
  "date",
  "regexp",
  "map",
  "set",
  "error",
  "function",
  "bytes",
  "ref",
  "truncated",
  "unknown",
];

const scalar = fc.oneof(fc.string(), fc.double(), fc.integer(), fc.boolean(), fc.constant(null));

/** A key, sometimes one that looks like a marker tag or an escaped one. */
const key = fc.oneof(
  fc.string(),
  fc.constantFrom("$type", "$class", "$$type", "entries", "values", "path", "__proto__"),
);

/** A marker with random (sometimes wrong) fields. */
const marker = fc.record(
  {
    $type: fc.constantFrom(...markerTypes),
    value: fc.oneof(scalar, fc.constantFrom("NaN", "-0", "Infinity", "123")),
    iso: fc.oneof(fc.constant("2026-10-10T14:02:11.000Z"), fc.string(), fc.constant(null)),
    name: fc.oneof(fc.string(), fc.integer()),
    message: fc.string(),
    base64: fc.oneof(fc.base64String(), fc.string()),
    length: fc.oneof(fc.nat(), fc.string()),
    path: fc.oneof(fc.array(fc.oneof(fc.string(), fc.nat()), { maxLength: 3 }), fc.string()),
    source: fc.string(),
    flags: fc.string(),
  },
  { requiredKeys: ["$type"] },
);

/** A random wire form up to a small depth. */
export const wireForm: fc.Arbitrary<unknown> = fc.letrec<{ node: unknown }>((tie) => ({
  node: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    scalar,
    marker,
    fc.array(tie("node"), { maxLength: 5 }),
    fc.dictionary(key, tie("node"), { maxKeys: 5 }),
    fc.record({
      $type: fc.constant("map"),
      entries: fc.array(fc.tuple(tie("node"), tie("node")), { maxLength: 3 }),
    }),
    fc.record({ $type: fc.constant("set"), values: fc.array(tie("node"), { maxLength: 3 }) }),
    fc.record({ $class: fc.string(), field: tie("node") }),
  ),
})).node;
