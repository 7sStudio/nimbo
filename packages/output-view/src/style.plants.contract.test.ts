// The style gate (@jsnb/style-gate) in the viewer's scope on planted faults: each template class compiled as the build
// compiles it and each sheet of the viewer's own forms must be refused by the rule named beside it, and what the
// style rules allow must pass. The gate's own tests (tools/style-gate) plant a fault for each rule on fixture CSS.
import { describe, expect, it } from "vitest";

import { compiled } from "./fixtures/compiled.js";
import { allowedClasses, refusedClasses } from "./fixtures/plantedClasses.js";
import { allowedSheet, refusedSheets } from "./fixtures/plantedSheets.js";
import { faults } from "./fixtures/viewerGate.js";

/** The rules that refuse `css`. */
const rulesFor = async (css: string): Promise<string[]> =>
  (await faults(css)).map((fault) => fault.rule);

describe("the gate on template classes, compiled", () => {
  it.each(refusedClasses)("refuses %s by %s", async (className, rule) => {
    expect(await rulesFor(await compiled(className))).toContain(rule);
  });

  it.each(allowedClasses)("passes %s", async (className) => {
    const css = await compiled(className);
    expect(css, "the class builds a rule").toContain(".ov\\:");
    expect(await faults(css)).toEqual([]);
  });
});

describe("the gate on hand-written sheets", () => {
  it.each(refusedSheets)("refuses %s by %s", async (css, rule) => {
    expect(await rulesFor(css)).toContain(rule);
  });

  it("passes what the style rules allow", async () => {
    expect(await faults(allowedSheet)).toEqual([]);
  });
});
