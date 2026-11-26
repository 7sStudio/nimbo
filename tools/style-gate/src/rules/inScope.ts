// jsnb/in-scope: every rule styles the package's own elements, never the page and never a live slot or the
// user's elements in it, which the package leaves unstyled. A selector's subject (its last compound) passes
// when it carries a prefixed class or is the root, or when it excludes the live slot and all it holds,:
// not([data-live], [data-live] *), and sits under the root through descendant or child combinators. Excluding only
// what the slot holds, :not([data-live] *), still matches the slot, from which every inherited property reaches the
// user's elements. An :is() or :where() counts when every selector it lists passes, so :is(.root, body) does not.
// Selectors are parsed, not searched.
import { AtRule } from "postcss";
import selectorParser from "postcss-selector-parser";
import type { Node as Part, Selector } from "postcss-selector-parser";

import type { GateScope } from "../scope.js";
import { gateRule } from "./rule.js";

type Compound = { readonly parts: Part[]; readonly right: string | undefined };

/** The compounds of `selector` from its subject leftwards, each with the combinator on its right. */
function compounds(selector: Selector): Compound[] {
  const found: Compound[] = [];
  let parts: Part[] = [];
  let right: string | undefined;
  for (const part of [...selector.nodes].reverse()) {
    if (part.type === "combinator") {
      found.push({ parts, right });
      right = part.value.trim() === "" ? " " : part.value.trim();
      parts = [];
    } else if (part.type !== "comment") parts.unshift(part);
  }
  return [...found, { parts, right }];
}

/** Whether `parts` carry a class `own` accepts, or an :is() or :where() whose every selector `listed` accepts. */
const carries = (
  parts: Part[],
  own: (name: string) => boolean,
  listed: (selector: Selector) => boolean,
): boolean =>
  parts.some((part) =>
    part.type === "class"
      ? own(part.value)
      : part.type === "pseudo" &&
        [":is", ":where"].includes(part.value) &&
        part.nodes.every(listed),
  );

/** The selectors the :not()s of `parts` list, spaces collapsed. */
const negated = (parts: Part[]): string[] =>
  parts.flatMap((part) =>
    part.type === "pseudo" && part.value === ":not"
      ? part.nodes.map((listed) => listed.toString().trim().replace(/\s+/gu, " "))
      : [],
  );

/** Whether the elements a selector styles are the scope's own (see the head comment). */
function insideOf({ root, prefix, live }: GateScope): (selector: Selector) => boolean {
  const isRoot = (selector: Selector): boolean => {
    const [only, ...more] = compounds(selector);
    return (
      more.length === 0 &&
      only !== undefined &&
      carries(only.parts, (name) => name === root, isRoot)
    );
  };
  const own = (name: string): boolean => name.startsWith(`${prefix}:`) || name === root;
  const inside = (selector: Selector): boolean => {
    const [subject, ...ancestors] = compounds(selector);
    if (subject === undefined) return false;
    if (carries(subject.parts, own, inside)) return true;
    const excluded = negated(subject.parts);
    return (
      excluded.includes(live) &&
      excluded.includes(`${live} *`) &&
      ancestors.some(
        ({ parts, right }) =>
          (right === " " || right === ">") && carries(parts, (name) => name === root, isRoot),
      )
    );
  };
  return inside;
}

export function inScope(scope: GateScope): ReturnType<typeof gateRule> {
  const inside = insideOf(scope);
  return gateRule("in-scope", (root, report) => {
    root.walkRules((rule) => {
      if (rule.parent instanceof AtRule && rule.parent.name.endsWith("keyframes")) return;
      selectorParser((selectors) => {
        for (const selector of selectors.nodes) {
          if (!inside(selector))
            report(rule, `${selector.toString().trim()} styles outside the scope`);
        }
      }).processSync(rule.selector);
    });
  });
}
