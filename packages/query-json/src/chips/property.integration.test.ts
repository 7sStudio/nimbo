// Property tests of Filter mode through the engine, integration tier: contains, startsWith and matches chips compile to
// search() and match(), which run in the JSONPath worker. On random records the engine selects exactly what a direct
// evaluator of RFC 9535's rules (fixtures/oracle.ts) says the chips hold for, and on any JSON it never throws.
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createJsonPathEngine } from "../jsonpath/engine.ts";
import { chipsToJsonPath } from "./compile.ts";
import { chipList, chipOf, runs } from "./fixtures/arbitraries.ts";
import { holds } from "./fixtures/oracle.ts";
import type { ChipValue } from "./types.ts";

const pool: fc.Arbitrary<ChipValue> = fc.constantFrom(
  -1,
  0,
  1,
  2.5,
  1000,
  "",
  "a",
  "ab",
  "b",
  "A",
  "a.b",
  "$x",
  "^a",
  "é",
  "x y",
  true,
  false,
  null,
);
const member = fc.oneof(pool, fc.constant({ b: 1 }), fc.constant([0]));
const record = fc.record(
  {
    a: member,
    b: member,
    "first name": member,
    n: fc.oneof(fc.record({ b: member }, { requiredKeys: [] }), member),
    list: fc.oneof(fc.array(member, { maxLength: 2 }), member),
  },
  { requiredKeys: [] },
);
const poolKey = fc.constantFrom("a", "b", "first name", "n.b", "list[0]", "missing");
const poolText = fc.constantFrom("", "a", "b", ".", "$", "^", "é", " ");
const poolPattern = fc.constantFrom("a+", "[ab]*", "b|é", ".*", "a.b", "");

const engine = createJsonPathEngine();
beforeAll(() => engine.load());
afterAll(() => engine.dispose());

describe("chips select what they describe", () => {
  it("selects exactly the records the chips hold for", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(record, { maxLength: 8 }),
        fc.array(chipOf(poolKey, pool, poolText, poolPattern), { maxLength: 3 }),
        async (records, chips) => {
          const compiled = engine.compile(chipsToJsonPath(chips));
          if (!compiled.ok) throw new Error(compiled.error.message);
          const expected = records.flatMap((r, index) =>
            chips.every((chip) => holds(chip, r)) ? [`$[${String(index)}]`] : [],
          );
          expect(await compiled.value.select(records)).toEqual({
            ok: true,
            value: { paths: expected },
          });
        },
      ),
      runs,
    );
  });
});

describe("chip queries on any JSON", () => {
  it("never throw, and select from any value", async () => {
    await fc.assert(
      fc.asyncProperty(chipList, fc.jsonValue(), async (chips, json) => {
        const compiled = engine.compile(chipsToJsonPath(chips));
        if (!compiled.ok) throw new Error(compiled.error.message);
        expect(await compiled.value.select(json)).toMatchObject({ ok: true });
      }),
      runs,
    );
  });
});
