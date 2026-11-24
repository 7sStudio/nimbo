// Property tests of paths.ts: normalized paths round-trip through parsePath and formatPath. 50 runs.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { formatPath, parsePath } from "./paths.ts";

const segment = fc.oneof(fc.string({ unit: "grapheme" }), fc.nat({ max: Number.MAX_SAFE_INTEGER }));

describe("formatPath and parsePath", () => {
  it("round-trip any segments", () => {
    fc.assert(
      fc.property(fc.array(segment), (segments) => {
        expect(parsePath(formatPath(segments))).toEqual({ ok: true, value: segments });
      }),
      { numRuns: 50 },
    );
  });

  it("leave a normalized path as it is", () => {
    fc.assert(
      fc.property(fc.array(segment), (segments) => {
        const path = formatPath(segments);
        const parsed = parsePath(path);
        expect(parsed.ok && formatPath(parsed.value)).toBe(path);
      }),
      { numRuns: 50 },
    );
  });
});
