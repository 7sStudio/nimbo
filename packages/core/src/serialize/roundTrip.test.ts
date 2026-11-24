// Property tests: decode(encode(x)) deep-equals x for random plain data and encoding is stable.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { decode } from "./decode.js";
import { encode, encodeStrict } from "./encode.js";

const scalar = fc.oneof(
  fc.jsonValue({ maxDepth: 0 }),
  fc.bigInt(),
  fc.date({ noInvalidDate: true }),
  fc.constant(undefined),
  fc.double({ noNaN: false }),
);

const plain = fc.letrec<{ value: unknown }>((tie) => ({
  value: fc.oneof(
    { depthSize: "small", maxDepth: 3 },
    scalar,
    fc.array(tie("value"), { maxLength: 4 }),
    fc.dictionary(fc.string({ maxLength: 4 }), tie("value"), { maxKeys: 4 }),
    fc.array(fc.tuple(scalar, tie("value")), { maxLength: 3 }).map((entries) => new Map(entries)),
    fc.array(scalar, { maxLength: 4 }).map((values) => new Set(values)),
  ),
})).value;

const runs = { numRuns: 20 };

describe("encode and decode", () => {
  it("round-trip random plain data in output mode", () => {
    fc.assert(
      fc.property(plain, (value) => {
        const encoded = encode(value);
        expect(encoded.truncated).toBe(false);
        expect(decode(encoded.json)).toEqual(value);
      }),
      runs,
    );
  });

  it("round-trip random plain data in strict mode", () => {
    fc.assert(
      fc.property(plain, (value) => {
        const result = encodeStrict(value);
        expect(result.ok).toBe(true);
        expect(decode(result.ok ? result.json : undefined)).toEqual(value);
      }),
      runs,
    );
  });

  it("are stable: encoding a decoded form gives the same form", () => {
    fc.assert(
      fc.property(plain, (value) => {
        const once = encode(value).json;
        expect(encode(decode(once)).json).toEqual(once);
      }),
      runs,
    );
  });
});
