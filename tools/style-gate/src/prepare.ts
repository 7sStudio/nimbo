// A compiled stylesheet as the gate reads it. Two things in it are not the package's to judge: the minifier writes the
// keyword transparent as #0000, which the gate reads back as transparent, and the rule that sets Tailwind's --tw-*
// initial values (GateScope.defaults), Tailwind's own, #fff among them, which the gate leaves out when it is that rule
// exactly: those selectors, in the utilities layer, holding nothing but --tw-* declarations. A page's sheet
// (GateScope.page) also has its tokens on :root, the one place a color is literal (@jsnb/tokens' page.css and the
// page's theme/tokens.css, linted as source with their own rules), which the gate leaves out too once jsnb/page-level's
// shape holds for them (rules/pageLevel.ts).
import postcss, { AtRule } from "postcss";
import type { Rule } from "postcss";

import { isRootTokens } from "./rules/pageLevel.js";

/** A selector as a key, so the minifier's spelling (spaces, :before) and the plugin's compare equal. */
const key = (selector: string): string => selector.replace(/\s+|(?<=:):/gu, "");

/** Removes `rule`, then each at-rule around it that it leaves empty. */
function removeWithEmptyParents(rule: Rule): void {
  let parent = rule.parent;
  rule.remove();
  while (parent instanceof AtRule && parent.nodes.length === 0) {
    const next = parent.parent;
    parent.remove();
    parent = next;
  }
}

/** `css` without the defaults rule (and a page's :root tokens) and with the minifier's #0000 read back as
 * transparent. */
export function prepared(css: string, defaultsSelectors: readonly string[], page = false): string {
  const defaults = new Set(defaultsSelectors.map(key));
  const isDefaults = (rule: Rule): boolean =>
    rule.parent instanceof AtRule &&
    rule.parent.name === "layer" &&
    rule.parent.params === "utilities" &&
    rule.selectors.length === defaults.size &&
    rule.selectors.every((selector) => defaults.has(key(selector))) &&
    rule.nodes.every((node) => node.type === "decl" && node.prop.startsWith("--tw-"));
  const root = postcss.parse(css);
  const out: Rule[] = [];
  root.walkRules((rule) => {
    if (isDefaults(rule) || (page && isRootTokens(rule))) out.push(rule);
  });
  out.forEach(removeWithEmptyParents);
  root.walkDecls((decl) => {
    decl.value = decl.value.replace(/#0{4}(?:0{4})?(?![\da-f])/giu, "transparent");
  });
  return root.toString();
}
