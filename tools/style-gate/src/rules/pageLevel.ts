// jsnb/page-level: what a page's own stylesheet (the ui's, GateScope.page) may set outside its root, which a viewer's
// sheet may not: the tokens on :root, which style nothing by themselves (custom properties and
// color-scheme only, on :root or :root[data-theme=…], which prepare.ts takes out of the lint), @font-face for the families the page bundles, and @keyframes
// whose names carry the page's prefix, so a user's own @keyframes of the same name never meets ours. Nothing else
// reaches the page: a :root rule that sets more stays in the sheet, refused here and by in-scope.
import { AtRule } from "postcss";
import type { Rule } from "postcss";

import type { GateScope, PageScope } from "../scope.js";
import { gateRule } from "./rule.js";

const rootSelector = /^:root(?:\[data-theme=(?:"[a-z]+"|'[a-z]+'|[a-z]+)\])?$/u;

/** Whether `rule` sets page tokens: :root selectors only, holding custom properties and color-scheme only. */
export const isRootTokens = (rule: Rule): boolean =>
  rule.selectors.every((selector) => rootSelector.test(selector.trim())) &&
  rule.nodes.every(
    (node) =>
      node.type === "comment" ||
      (node.type === "decl" && (node.prop.startsWith("--") || node.prop === "color-scheme")),
  );

/** The allowed at-rules and, for a page, the two it adds. */
export const pageAtRules = ["font-face", "keyframes"] as const;

/** The family an @font-face declares, its quotes removed. */
function family(face: AtRule): string {
  let found = "";
  face.walkDecls("font-family", (decl) => {
    found = decl.value.replace(/^["']|["']$/gu, "");
  });
  return found;
}

function checkPage(page: PageScope): ReturnType<typeof gateRule> {
  return gateRule("page-level", (root, report) => {
    root.walkAtRules((at) => {
      if (at.name === "font-face" && !page.fonts.includes(family(at))) {
        report(at, `@font-face for ${family(at) || "no family"}, not a family the page bundles`);
      }
      if (at.name.endsWith("keyframes") && !at.params.trim().startsWith(page.keyframes)) {
        report(at, `@keyframes ${at.params.trim()} without the page's prefix ${page.keyframes}`);
      }
    });
    root.walkRules((rule) => {
      const inKeyframes = rule.parent instanceof AtRule && rule.parent.name.endsWith("keyframes");
      if (inKeyframes || !rule.selectors.some((selector) => selector.trim().startsWith(":root")))
        return;
      if (!isRootTokens(rule)) report(rule, `${rule.selector} sets more than tokens on the page`);
    });
  });
}

/** The rule for a page's sheet; a viewer's has none, and at-rule-allowed-list refuses what it would allow. */
export const pageLevel = ({ page }: GateScope): ReturnType<typeof gateRule>[] =>
  page === undefined ? [] : [checkPage(page)];
