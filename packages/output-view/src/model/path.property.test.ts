// Property tests of path.ts: any path survives format → parse, in both forms.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { formatKey, formatPath, normalizedPath, parseKey, parsePath } from "./path.js";

const segment = fc.oneof(fc.string(), fc.nat({ max: 1_000_000 }));
const path = fc.array(segment, { maxLength: 6 });

describe("paths", () => {
  it("parses the copy-path form back to the same segments", () => {
    fc.assert(
      fc.property(path, (p) => {
        expect(parsePath(formatPath(p))).toEqual({ ok: true, value: p });
      }),
      { numRuns: 50 },
    );
  });

  it("parses the normalized form back to the same segments", () => {
    fc.assert(
      fc.property(path, (p) => {
        expect(parsePath(normalizedPath(p))).toEqual({ ok: true, value: p });
      }),
      { numRuns: 50 },
    );
  });

  it("reads a formatted key back to the same segments", () => {
    fc.assert(
      fc.property(fc.array(segment, { minLength: 1, maxLength: 4 }), (p) => {
        expect(parseKey(formatKey(p))).toEqual(p);
      }),
      { numRuns: 50 },
    );
  });

  it("never throws on any text", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(typeof parsePath(text).ok).toBe("boolean");
      }),
      { numRuns: 50 },
    );
  });
});
