// The route form's properties: routePath is idempotent, and on a ref's segments it is the encoding
// notebookName gives them, so the daemon finds a notebook by the same form its route URLs print.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { notebookName } from "./notebookName.js";
import { routePath } from "./routePath.js";

const runs = { numRuns: 50 };

describe("routePath's properties", () => {
  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 24 }), (text) => {
        const once = routePath(text);
        expect(routePath(once)).toBe(once);
      }),
      runs,
    );
  });

  it("is the encoding notebookName gives a ref's segments", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ unit: "grapheme", minLength: 1, maxLength: 8 }), { minLength: 1 }),
        (segments) => {
          const raw = segments.filter((s) => !s.includes("/")).join("/");
          fc.pre(raw !== "");
          expect(routePath(notebookName(`${raw}.jsnb`))).toBe(notebookName(`${raw}.jsnb`));
        },
      ),
      runs,
    );
  });
});
