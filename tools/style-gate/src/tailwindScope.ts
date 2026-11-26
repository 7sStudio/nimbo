// A PostCSS plugin for a package's compiled Tailwind (output-view's and ui's vite.config.ts, and their test projects in
// the root vitest.config.ts): it keeps Tailwind's --tw-* internals inside `scope` (nothing of ours styles
// anything outside .jsnb-ov or .jsnb-ui). Tailwind v4 registers them with @property, which holds for the whole page
// (a prefix renames the classes and the theme's variables, not these), and sets them on every element (*, ::before,:
// :after, ::backdrop) in a fallback for browsers without @property. The plugin drops both and declares the
// registrations' initial values on the scope's elements and their ::before and ::after, which is what the registrations
// gave them: each element starts from the initial value instead of inheriting its parent's. The build half of the gate
// (gate.ts reads the defaults rule it writes through GateScope.defaults).
//
// The defaults sit in the utilities layer at zero specificity (inside :where()), so every utility that sets one wins by
// specificity whatever order a page gives its layers (the ui's layer statement has no properties layer, which would put that
// layer above the utilities), and `except` (a DOM output's live container) keeps the user's elements out of them.
import type { AtRule, Plugin, Rule } from "postcss";

const universal = new Set(["*", "::before", ":before", "::after", ":after", "::backdrop"]);

/** Whether `rule` is Tailwind's fallback that sets the internals on every element of the page. */
const isFallback = (rule: Rule): boolean =>
  rule.selectors.includes("*") &&
  rule.selectors.every((selector) => universal.has(selector.trim()));

/** Removes `node`, then each at-rule around it that it leaves empty. */
function removeWithEmptyParents(node: Rule): void {
  let parent = node.parent;
  node.remove();
  while (parent?.type === "atrule" && parent.nodes.length === 0) {
    const next = parent.parent;
    parent.remove();
    parent = next;
  }
}

export type ScopeOptions = {
  /** The root the internals stay inside, `.jsnb-ov` or `.jsnb-ui`. */
  readonly scope: string;
  /** A part of the scope that is not ours to style, `[data-live]`: it and what it holds get no defaults. */
  readonly except: string;
};

/** The defaults rule's selectors: the scope's elements outside `except`, and their ::before and ::after. */
export function defaultsSelectors({ scope, except }: ScopeOptions): string[] {
  const elements = `:where(${scope}, ${scope} :not(${except}, ${except} *))`;
  return [elements, `${elements}::before`, `${elements}::after`];
}

export function scopeTailwindProperties(options: ScopeOptions): Plugin {
  return {
    postcssPlugin: "jsnb-scope-tailwind-properties",
    Once(root, { postcss }) {
      const initial: [string, string][] = [];
      let first: AtRule | undefined;
      root.walkAtRules("property", (registration) => {
        const name = registration.params.trim();
        if (!name.startsWith("--tw-")) return;
        let value = "initial";
        registration.walkDecls("initial-value", (decl) => {
          value = decl.value;
        });
        initial.push([name, value]);
        first ??= registration.clone();
        registration.remove();
      });
      root.walkRules((rule) => {
        if (isFallback(rule)) removeWithEmptyParents(rule);
      });
      if (first === undefined) return;
      // the created nodes carry the first registration's source, so Vite's CSS pipeline knows their file
      const source = first.source;
      const rule = postcss.rule({
        selectors: defaultsSelectors(options),
        ...(source ? { source } : {}),
      });
      for (const [prop, value] of initial) {
        rule.append(postcss.decl({ prop, value, ...(source ? { source } : {}) }));
      }
      const layer = postcss.atRule({
        name: "layer",
        params: "utilities",
        ...(source ? { source } : {}),
      });
      root.append(layer.append(rule));
    },
  };
}
