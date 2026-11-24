// Tests the gate rule by rule on fixture CSS (fixtures/valueCases.ts, fixtures/selectorCases.ts): each sheet a rule must
// refuse is refused by it, each sheet it must pass has no fault at all, and one sheet holding every fault fails every
// rule, so the gate is never vacuous, not even for a file the repository's ignoreFiles names.
import { beforeAll, describe, expect, it } from "vitest";

import { selectorCases } from "./fixtures/selectorCases.js";
import { repository, scope } from "./fixtures/repository.js";
import { valueCases } from "./fixtures/valueCases.js";
import { styleGate } from "./gate.js";

const faults = styleGate(scope, repository);
const cases = [...valueCases, ...selectorCases];

// The gate's first call resolves the repository's configuration and loads Stylelint's rules: setup, not any one test's
// time.
beforeAll(() => faults(""));

/** The rules that refuse `css`. */
const rulesFor = async (css: string): Promise<string[]> =>
  (await faults(css)).map((fault) => fault.rule);

describe.each(cases)("$rule", ({ rule, refused, passed }) => {
  it.each(refused)("refuses %s", async (css) => {
    expect(await rulesFor(css)).toContain(rule);
  });

  it.each(passed)("passes %s", async (css) => {
    expect(await faults(css)).toEqual([]);
  });
});

describe("the gate as a whole", () => {
  it("fails every rule on a sheet holding a fault of each, though the repository ignores dist files", async () => {
    const sheet = cases.map(({ refused }) => refused[0]).join("\n");
    const found = new Set(await rulesFor(sheet));
    expect([...found].sort()).toEqual(cases.map(({ rule }) => rule).sort());
    expect(repository.config.ignoreFiles).toEqual(["**/dist/**"]);
    expect(repository.file).toMatch(/\/dist\/style\.css$/u);
  });

  it("passes an empty sheet", async () => {
    expect(await faults("")).toEqual([]);
  });
});
