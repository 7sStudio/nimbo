// Property test, integration tier: every valid selector of the compliance suite, on any JSON, selects without throwing;
// the selectors whose cost is not linear run in the JSONPath worker. 50 runs.
import { readFileSync } from "node:fs";

import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createJsonPathEngine } from "./engine.ts";

const suite = JSON.parse(
  readFileSync(new URL("fixtures/cts/cts.json", import.meta.url), "utf8"),
) as {
  tests: { selector: string; invalid_selector?: true }[];
};
const selectors = suite.tests.filter((c) => !c.invalid_selector).map((c) => c.selector);

const engine = createJsonPathEngine();
beforeAll(() => engine.load());
afterAll(() => engine.dispose());

describe("valid CTS selectors on any JSON", () => {
  it("never throw, and select from any value", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...selectors), fc.jsonValue(), async (selector, json) => {
        const compiled = engine.compile(selector);
        if (!compiled.ok) throw new Error(compiled.error.message);
        expect(await compiled.value.select(json)).toMatchObject({ ok: true });
      }),
      { numRuns: 50 },
    );
  });
});
