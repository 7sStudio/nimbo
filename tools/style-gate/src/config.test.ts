// Tests the gate's configuration (config.ts) on the repository's rules as stylelint.resolveConfig() gives them: it takes
// three as they are, merges what compiled CSS needs into the px and outline rules, and refuses a configuration that no
// longer sets one of them or sets it in a shape it cannot extend.
import stylelint from "stylelint";
import type { Config } from "stylelint";
import { describe, expect, it } from "vitest";

import { gateConfig } from "./config.js";
import { repository, repositoryRules, scope } from "./fixtures/repository.js";

type Rules = NonNullable<Config["rules"]>;

/** The repository's configuration with `rules`, resolved for a CSS file as the gate resolves it. */
const resolved = (rules: Rules): Promise<Config | undefined> =>
  stylelint.resolveConfig(repository.file, { config: { ...repository.config, rules } });

const px = ["/^border(?!.*radius)/", "/^outline/", "box-shadow", "--shadow"];
const compiledPx = ["stroke-width", "/^--tw-(?:inset-)?(?:shadow|ring)/"];
const absolute = ["pt", "pc", "cm", "mm", "in", "q"];

describe("the repository's rules", () => {
  it("takes the three it reuses as stylelint.config.js sets them", async () => {
    expect(gateConfig(await resolved(repositoryRules), scope).rules).toMatchObject({
      "color-no-hex": [true],
      "color-named": ["never"],
      "declaration-no-important": [true],
    });
  });

  it("keeps the repository's px and outline lists and adds compiled CSS's to them", async () => {
    const rules = gateConfig(await resolved(repositoryRules), scope).rules ?? {};
    expect(rules["unit-disallowed-list"]).toEqual([
      ["px", ...absolute],
      { ignoreProperties: { px: [...px, ...compiledPx] } },
    ]);
    expect(rules["declaration-property-value-disallowed-list"]).toEqual([
      {
        outline: ["none", "0", "/^0(?:px)?(?:\\s|$)/"],
        "outline-style": ["none"],
        "outline-width": ["/^0(?:px)?$/"],
        "/^overflow/": ["/\\bhidden\\b/"],
      },
    ]);
  });

  it("adds them to a single unit with no exceptions", async () => {
    const config = await resolved({ ...repositoryRules, "unit-disallowed-list": "px" });
    expect(gateConfig(config, scope).rules?.["unit-disallowed-list"]).toEqual([
      ["px", ...absolute],
      { ignoreProperties: { px: compiledPx } },
    ]);
  });
});

/** Settings of the px and outline rules the gate cannot extend, as written in stylelint.config.js, and the error. */
const shapes: [string, unknown, string][] = [
  ["unit-disallowed-list", true, "unit-disallowed-list's units is not a list"],
  ["unit-disallowed-list", [["px"], { ignoreProperties: { px: "border" } }], "its px exceptions"],
  ["unit-disallowed-list", [["px"], { ignoreProperties: [] }], "its ignoreProperties"],
  ["declaration-property-value-disallowed-list", [["none"]], "values is not an object"],
  ["declaration-property-value-disallowed-list", { outline: "none" }, "its outline is not a list"],
];
/** Settings only a caller of gateConfig() could pass, not resolveConfig(). */
const unresolved: [string, unknown, string][] = [
  ["unit-disallowed-list", 42, "unit-disallowed-list is not a list"],
  ["unit-disallowed-list", [["px"], true], "unit-disallowed-list's options is not an object"],
];

describe("a configuration the gate cannot run on", () => {
  it("names each rule the repository no longer sets", async () => {
    const { "color-named": named, "unit-disallowed-list": units, ...rest } = repositoryRules;
    expect([named, units]).not.toContain(undefined);
    expect(() => gateConfig(undefined, scope)).toThrow(/no longer sets color-no-hex/u);
    const config = await resolved(rest);
    expect(() => gateConfig(config, scope)).toThrow(
      "stylelint.config.js no longer sets color-named, unit-disallowed-list for the package",
    );
  });

  it("refuses a px rule or an outline rule in a shape it cannot extend", async () => {
    for (const [rule, setting, message] of shapes) {
      const config = await resolved({ ...repositoryRules, [rule]: setting });
      expect(() => gateConfig(config, scope), rule).toThrow(message);
    }
  });

  it("refuses one that resolveConfig() would not give, as a caller could pass it", () => {
    for (const [rule, setting, message] of unresolved) {
      const rules = { ...repositoryRules, [rule]: setting };
      expect(() => gateConfig({ rules }, scope), rule).toThrow(message);
    }
  });
});
