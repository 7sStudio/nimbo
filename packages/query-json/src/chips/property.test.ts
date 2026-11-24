// Property tests of Filter mode in the calling thread: chips → JSONPath → chips, and every generated query compiles.
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";

import { createJsonPathEngine } from "../jsonpath/engine.ts";
import { formatPath } from "../paths.ts";
import { chipsToJsonPath } from "./compile.ts";
import { chipList, runs, text } from "./fixtures/arbitraries.ts";
import { formatKey, keySegments, shorthand } from "./key.ts";
import { jsonPathToChips } from "./parse.ts";
import type { Chip } from "./types.ts";

const canonical = (chip: Chip): Chip => {
  const key = formatKey(keySegments(chip.key));
  if (chip.op === "exists") return { key, op: chip.op };
  return { ...chip, key, value: Object.is(chip.value, -0) ? 0 : chip.value } as Chip;
};

const segments = fc.array(fc.oneof(text, fc.nat({ max: 99 })), { maxLength: 3 });

const engine = createJsonPathEngine();
beforeAll(() => engine.load());

describe("chips ↔ JSONPath", () => {
  it("reads back the chips and the filtered node of every generated query", () => {
    fc.assert(
      fc.property(chipList, segments, (chips, at) => {
        expect(jsonPathToChips(chipsToJsonPath(chips, formatPath(at)))).toEqual({
          at: `$${shorthand(at)}`,
          chips: chips.map(canonical),
        });
      }),
      runs,
    );
  });

  it("generates queries the JSONPath engine compiles", () => {
    fc.assert(
      fc.property(chipList, segments, (chips, at) => {
        expect(engine.compile(chipsToJsonPath(chips, formatPath(at)))).toMatchObject({ ok: true });
      }),
      runs,
    );
  });
});
