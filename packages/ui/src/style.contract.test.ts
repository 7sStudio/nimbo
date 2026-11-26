// The style rules on the stylesheet the page ships (dist/assets/index-*.css, after `pnpm build`), whose rules are mostly the
// components' ui: utilities, which Stylelint never sees in the CSS files it lints: the gate (@jsnb/style-gate) runs
// Stylelint itself on the built sheet, with what a page alone may set (GateScope.page). Its own tests show each rule
// biting on fixture CSS.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import postcss, { AtRule } from "postcss";
import { describe, expect, it } from "vitest";

import { faults, viewerFaults } from "./fixtures/pageGate.js";

/** Every class a selector of `css` names, unescaped (`ui:flex` from `.ui\\:flex`); keyframe steps are not selectors. */
function selectorClasses(css: string): ReadonlySet<string> {
  const classes = new Set<string>();
  postcss.parse(css).walkRules((rule) => {
    if (rule.parent instanceof AtRule && rule.parent.name.endsWith("keyframes")) return;
    for (const match of rule.selector.matchAll(/\.((?:\\.|[\w-])+)/gu)) {
      classes.add((match[1] ?? "").replace(/\\(.)/gu, "$1"));
    }
  });
  return classes;
}

const assets = fileURLToPath(new URL("../dist/assets/", import.meta.url));
const css = existsSync(assets) ? readdirSync(assets).filter((name) => name.endsWith(".css")) : [];
// The page's own sheet; output-view's (style-*.css and theme-*.css) are linked beside it by main.ts and gated with
// output-view's scope.
const sheets = css.filter((name) => name.startsWith("index-"));

describe("the built page's stylesheet", () => {
  it("exists, one sheet: the contract stage runs after the build", () => {
    expect(sheets, "run `pnpm build` first").toHaveLength(1);
  });

  it("keeps every rule inside .jsnb-ui and within the style rules", async () => {
    const css = readFileSync(join(assets, sheets[0] ?? ""), "utf8");
    expect(await faults(css)).toEqual([]);
  });

  it("lets no Tailwind internal or reset reach the page: no @property, no universal rule", () => {
    const css = readFileSync(join(assets, sheets[0] ?? ""), "utf8");
    expect(css).not.toMatch(/@property/u);
    expect(css).not.toMatch(/(?:^|[},])\s*\*\s*[,{]/u);
  });

  it("names no class but ours: every utility is ui:-prefixed, so a user's class=flex or hidden is never styled", () => {
    const css = readFileSync(join(assets, sheets[0] ?? ""), "utf8");
    const foreign = [...selectorClasses(css)].filter(
      (name) => !name.startsWith("ui:") && name !== "jsnb-ui",
    );
    expect(foreign).toEqual([]);
    expect(selectorClasses(css)).toContain("ui:flex");
  });

  it("opens with the layer order, Tailwind's properties layer lowest", () => {
    const css = readFileSync(join(assets, sheets[0] ?? ""), "utf8");
    expect(css.startsWith("@layer properties,tokens,base,components,utilities;")).toBe(true);
  });
});

describe("output-view's sheets beside the page's", () => {
  it("ships output-view's sheets apart from ours, its views within the style rules and its theme under .jsnb-ov", async () => {
    const others = css.filter((name) => !sheets.includes(name));
    expect(others.map((name) => name.split("-")[0]).sort()).toEqual(["style", "theme"]);
    const views = others.find((name) => name.startsWith("style-")) ?? "";
    expect(await viewerFaults(readFileSync(join(assets, views), "utf8"))).toEqual([]);
    // the theme is output-view's own tokens (oklch, as ours are) and the base of a .jsnb-ov root, nothing else
    const theme = readFileSync(
      join(assets, others.find((name) => name.startsWith("theme-")) ?? ""),
      "utf8",
    );
    const selectors = [...theme.matchAll(/(?:^|[}{;])\s*([^{};@]+)\{/gu)].map(
      (match) => match[1]?.trim() ?? "",
    );
    expect(selectors.length).toBeGreaterThan(0);
    expect(selectors.filter((selector) => !selector.startsWith(".jsnb-ov"))).toEqual([]);
  });
});
