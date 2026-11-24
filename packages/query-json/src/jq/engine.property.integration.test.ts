// Worker-backed property test (integration tier): jq programs never throw on random JSON, they return a Result.
// 50 runs per property.
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createJqEngine } from "./engine.ts";

const programs = [
  ".",
  ".[]?",
  "..",
  "keys?",
  "length",
  "type",
  "tostring",
  "tojson | fromjson",
  "[paths] | length",
  "to_entries?",
  ".a?",
  ".[0]?",
  "add?",
  "map(type)?",
  'walk(if type == "number" then . + 1 else . end)',
  "[.. | numbers] | add",
  ".a.b.c",
  "error",
  "keys",
  "-.",
];

const engine = createJqEngine();
beforeAll(() => engine.load());
afterAll(() => engine.dispose());

describe("jq programs on any JSON", () => {
  it("never throw, and return a value or a query error", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...programs), fc.jsonValue(), async (program, json) => {
        const compiled = engine.compile(program);
        if (!compiled.ok) throw new Error(compiled.error.message);
        const result = await compiled.value.transform(json);
        expect(result.ok ? typeof result.value.count : result.error.kind).toMatch(
          /^(number|runtime)$/,
        );
      }),
      { numRuns: 50 },
    );
  });
});
