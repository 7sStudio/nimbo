// Property tests of search.ts: find never throws on random wire forms and queries, and every match is a real node.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { wireForm } from "./fixtures/arbitrary.js";
import { formatPath } from "./path.js";
import { search } from "./search.js";
import { resolve } from "./wire.js";

const query = fc.oneof(
  fc.string(),
  fc.string().map((s) => `/${s}/`),
  fc.constantFrom("a", "1", "/./g", "$", "["),
);

describe("search", () => {
  it("never throws and finds only nodes that exist", () => {
    fc.assert(
      fc.property(
        wireForm,
        query,
        fc.constantFrom("keys" as const, "values" as const, "both" as const),
        (json, text, scope) => {
          const outcome = search(json, text, { scope });
          if (!outcome.ok) return;
          for (const match of outcome.value.matches) {
            expect(match.id).toBe(formatPath(match.path));
            expect(resolve(json, match.path)).toBeDefined();
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
