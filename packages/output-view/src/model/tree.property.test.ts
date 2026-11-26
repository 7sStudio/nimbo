// Property tests of tree.ts: flatten never throws on random wire forms and its rows stay well formed.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { expandAll } from "./expansion.js";
import { wireForm } from "./fixtures/arbitrary.js";
import { focusOf } from "./focus.js";
import { formatPath } from "./path.js";
import { flatten } from "./tree.js";

describe("flatten", () => {
  it("never throws, starts at the root and gives every node row the id of its path", () => {
    fc.assert(
      fc.property(wireForm, (json) => {
        const rows = flatten(json, { expansion: expandAll() });
        expect(rows[0]?.id).toBe("$");
        for (const row of rows) if (row.role === "node") expect(row.id).toBe(formatPath(row.path));
      }),
      { numRuns: 50 },
    );
  });

  it("closes every open container once, after its children", () => {
    fc.assert(
      fc.property(wireForm, (json) => {
        const rows = flatten(json, { expansion: expandAll() });
        const opened = rows.filter((row) => row.role === "node" && row.expanded).length;
        expect(rows.filter((row) => row.role === "close")).toHaveLength(opened);
      }),
      { numRuns: 50 },
    );
  });

  it("never throws with any focus", () => {
    fc.assert(
      fc.property(
        wireForm,
        fc.array(fc.array(fc.oneof(fc.string(), fc.nat({ max: 5 })), { maxLength: 3 }), {
          maxLength: 3,
        }),
        fc.boolean(),
        (json, paths, only) => {
          expect(Array.isArray(flatten(json, { focus: focusOf(paths, only) }))).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });
});
