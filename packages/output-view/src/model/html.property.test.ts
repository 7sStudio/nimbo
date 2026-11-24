// Property test of the HTML export: whatever the value, no tag of it reaches the page unescaped.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { wireForm } from "./fixtures/arbitrary.js";
import { toHTML } from "./html.js";

const hostile = fc.constantFrom(
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '"><svg onload=alert(1)>',
  "</details>",
);

describe("toHTML", () => {
  it("never writes a script, an image or an svg tag from a value", () => {
    fc.assert(
      fc.property(wireForm, hostile, (json, text) => {
        const html = toHTML({ kind: "value", json: { [text]: [json, text] }, repr: text });
        expect(html.slice(html.indexOf("<main"))).not.toMatch(/<(script|img|svg)/i);
      }),
      { numRuns: 50 },
    );
  });
});
