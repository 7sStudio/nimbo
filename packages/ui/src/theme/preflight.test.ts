// Guards the Preflight rule: Tailwind without its reset, and our reset scoped to .jsnb-ui.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

/** Splits a selector list on the commas outside parentheses, so `:is(h1, h2)` stays one selector. */
const splitSelectors = (group: string): readonly string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of group) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  return [...parts, current].map((s) => s.trim()).filter((s) => s.length > 0);
};

/** The selectors of every rule directly inside `@layer base { … }`, with the braces stripped; a comment before a rule
 * is no part of its selector. */
const baseSelectors = (css: string): readonly string[] => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const body = /@layer base \{([\s\S]*)\}\s*$/.exec(rules)?.[1] ?? "";
  return [...body.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => splitSelectors(m[1] ?? ""));
};

describe("main.css", () => {
  const css = read("../main.css");

  it("imports Tailwind's utilities alone, prefixed ui:, never bare, its default theme or preflight", () => {
    const imports = [...css.matchAll(/@import\s+"([^"]+)"([^;]*);/g)];
    const tailwind = imports.filter(([, from]) => from?.startsWith("tailwindcss"));
    expect(tailwind.map(([, from, rest]) => [from, rest?.trim()])).toEqual([
      ["tailwindcss/utilities.css", "layer(utilities) prefix(ui)"],
    ]);
  });

  it("declares the layer order first, Tailwind's properties layer lowest", () => {
    expect(css).toMatch(/^@layer properties, tokens, base, components, utilities;$/m);
    expect(css.indexOf("@layer properties")).toBeLessThan(css.indexOf("@import"));
  });
});

describe("reset.css", () => {
  const selectors = baseSelectors(read("./reset.css"));

  it("has at least one rule in @layer base", () => {
    expect(selectors.length).toBeGreaterThan(0);
  });

  it("scopes every selector under .jsnb-ui", () => {
    for (const selector of selectors) {
      expect(selector, selector).toMatch(/^\.jsnb-ui(\s|$|\s*[:*>])/);
    }
  });
});
