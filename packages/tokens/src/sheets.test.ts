// Tests the two committed stylesheets (08-code-standards §2): each is byte for byte what scripts/generate.ts renders
// from the palette and the values, declares every token once under its own selector in the tokens layer, and the
// viewer's never reaches a host page's :root.
import { readFile } from "node:fs/promises";

import postcss, { AtRule } from "postcss";
import type { Rule } from "postcss";
import { describe, expect, it } from "vitest";

import { sheetPath, sheets, sheetSource } from "../scripts/generate.js";
import { colors } from "./palette.js";
import { valueGroups } from "./values.js";

const names = [
  ...Object.keys(colors),
  ...valueGroups.flatMap((group) => Object.keys(group.values)),
].map((name) => `--${name}`);

/** The rules of a sheet, each with its selector, the at-rule around it and the properties it declares. */
async function rulesOf(
  file: string,
): Promise<{ selector: string; layer: string; props: string[] }[]> {
  const root = postcss.parse(await readFile(sheetPath(file), "utf8"));
  const rules: Rule[] = [];
  root.walkRules((rule) => {
    rules.push(rule);
  });
  return rules.map((rule) => ({
    selector: rule.selector,
    layer: rule.parent instanceof AtRule ? rule.parent.params : "",
    props: rule.nodes.flatMap((node) => (node.type === "decl" ? [node.prop] : [])),
  }));
}

describe("the token sheets", () => {
  it.each(sheets)("$file is byte for byte what the generator renders", async (sheet) => {
    expect(await readFile(sheetPath(sheet.file), "utf8")).toBe(await sheetSource(sheet));
  });

  it("puts every token once on the page's :root, in the tokens layer", async () => {
    expect(await rulesOf("page.css")).toEqual([
      { selector: ":root", layer: "tokens", props: names },
    ]);
  });

  it("puts the same tokens on the viewer's root alone, never on a :root or inside a page that has them", async () => {
    const rules = await rulesOf("viewer.css");
    expect(rules).toEqual([
      { selector: ".jsnb-ov:where(:not([data-jsnb-tokens] *))", layer: "tokens", props: names },
    ]);
  });
});
