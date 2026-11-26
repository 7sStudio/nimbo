// jsnb/in-its-place: what the style rules allow in one place only, which Stylelint's rules cannot say (they refuse a value
// everywhere or nowhere, not by the media query or the rule around it):
// - motion (a transition, an animation, smooth scrolling) under @media (prefers-reduced-motion: no-preference); a value
//   of none, which stops motion, anywhere;
// - a :hover rule under @media (hover: hover) and (pointer: fine), where a mouse or trackpad gives one;
// - position: fixed on the scope's `fixed` utility only, which the package keeps for its full-screen dialog;
// - `all` on the scope's `live-slot` utility only, as `all: initial`, the live slot's reset: anywhere else it
//   resets what the package's own rules set, the :focus-visible ring of a lower layer among them, and `unset` or
//   `inherit` on the slot would pass inherited properties down to the user's elements.
import { AtRule } from "postcss";
import type { Declaration, Node, Rule } from "postcss";
import selectorParser from "postcss-selector-parser";

import type { GateScope } from "../scope.js";
import { gateRule } from "./rule.js";

/** Whether every query of a media query around `node` asks `condition` (written without spaces). */
function under(node: Node, condition: string): boolean {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    if (!(at instanceof AtRule) || at.name !== "media") continue;
    const queries = at.params.toLowerCase().replace(/\s+/gu, "").split(",");
    if (queries.every((query) => query.includes(condition) && !query.startsWith("not"))) {
      return true;
    }
  }
  return false;
}

const isMotion = ({ prop, value }: Declaration): boolean =>
  (/^(?:transition|animation)(?:-|$)/u.test(prop) && value !== "none") ||
  (prop === "scroll-behavior" && value === "smooth");

/** Whether a selector of `rule` holds a :hover, wherever it stands in it. */
function hovers(rule: Rule): boolean {
  let found = false;
  selectorParser((selectors) => {
    selectors.walkPseudos((pseudo) => {
      found ||= pseudo.value === ":hover";
    });
  }).processSync(rule.selector);
  return found;
}

/** Declarations the style rules allow on one utility of the scope only: what they match, and that utility's name. */
const held: readonly (readonly [(decl: Declaration) => boolean, string, string])[] = [
  [({ prop, value }) => prop === "position" && value === "fixed", "fixed", "position: fixed"],
  [({ prop }) => prop === "all", "live-slot", "all"],
];

/** Whether `decl` sits in the rule of the scope's utility `name` alone; `all` there only as `all: initial`. */
const onUtility = (decl: Declaration, prefix: string, name: string): boolean =>
  decl.parent?.type === "rule" &&
  decl.parent.selector === `.${prefix}\\:${name}` &&
  (decl.prop !== "all" || decl.value === "initial");

export function inItsPlace({ prefix }: GateScope): ReturnType<typeof gateRule> {
  return gateRule("in-its-place", (root, report) => {
    root.walkDecls((decl) => {
      if (isMotion(decl) && !under(decl, "(prefers-reduced-motion:no-preference)")) {
        report(decl, `${decl.prop}: ${decl.value} moves outside reduced motion's no-preference`);
      }
      for (const [matches, name, what] of held) {
        if (matches(decl) && !onUtility(decl, prefix, name)) {
          report(decl, `${what} off .${prefix}:${name}: ${decl.prop}: ${decl.value}`);
        }
      }
    });
    root.walkRules((rule) => {
      if (hovers(rule) && !under(rule, "(hover:hover)and(pointer:fine)")) {
        report(rule, `${rule.selector} hovers off a fine pointer`);
      }
    });
  });
}
