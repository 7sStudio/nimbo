// The scoping plugin on Tailwind's own output (tailwindScope.ts): the @property registrations and the page-wide
// fallback go, and their initial values sit on .jsnb-ov's elements only, in the properties layer.
import postcss from "postcss";
import { describe, expect, it } from "vitest";

import { scopeTailwindProperties } from "./tailwindScope.js";

/** What Tailwind 4.3.3 emits for one shadow utility, abridged to two internals. */
const tailwind = `@layer properties;
@layer utilities {
  .ov\\:shadow-soft { --tw-shadow: var(--shadow); box-shadow: var(--tw-shadow); }
}
@property --tw-shadow { syntax: "*"; inherits: false; initial-value: 0 0 #0000; }
@property --tw-shadow-color { syntax: "*"; inherits: false; }
@property --host-own { syntax: "*"; inherits: false; initial-value: 1; }
@layer properties {
  @supports ((-webkit-hyphens: none) and (not (margin-trim: inline))) {
    *, ::before, ::after, ::backdrop { --tw-shadow: 0 0 #0000; --tw-shadow-color: initial; }
  }
}`;

const options = { scope: ".jsnb-ov", except: "[data-live]" };

const scoped = () =>
  postcss([scopeTailwindProperties(options)]).process(tailwind, { from: "tailwind.css" }).root;

/** The selectors and the declarations of `root`'s last rule, the one the plugin adds. */
function added(root: ReturnType<typeof scoped>) {
  const layer = root.last;
  const rule = layer?.type === "atrule" ? layer.first : undefined;
  if (layer?.type !== "atrule" || rule?.type !== "rule") throw new Error("no rule added");
  const decls: string[] = [];
  rule.walkDecls((decl) => {
    decls.push(`${decl.prop}: ${decl.value}`);
  });
  return { layer: [layer.name, layer.params], selectors: rule.selectors, decls };
}

describe("scopeTailwindProperties", () => {
  it("drops Tailwind's @property registrations, and only those", () => {
    const names: string[] = [];
    scoped().walkAtRules("property", (rule) => {
      names.push(rule.params);
    });
    expect(names).toEqual(["--host-own"]);
  });

  it("drops the fallback on every element of the page, and the @supports it leaves empty", () => {
    const root = scoped();
    const selectors: string[] = [];
    root.walkRules((rule) => {
      selectors.push(rule.selector);
    });
    const unscoped = selectors.filter((s) => s.includes("*") && !s.includes(".jsnb-ov"));
    expect(unscoped).toEqual([]);
    const supports: string[] = [];
    root.walkAtRules("supports", (rule) => {
      supports.push(rule.params);
    });
    expect(supports).toEqual([]);
  });

  it("sets their initial values on .jsnb-ov's elements and pseudo-elements, outside the live container, in the utilities layer at zero specificity", () => {
    const elements = ":where(.jsnb-ov, .jsnb-ov :not([data-live], [data-live] *))";
    expect(added(scoped())).toEqual({
      layer: ["layer", "utilities"],
      selectors: [elements, `${elements}::before`, `${elements}::after`],
      decls: ["--tw-shadow: 0 0 #0000", "--tw-shadow-color: initial"],
    });
  });

  it("gives what it adds a source, so a bundler knows the file it comes from", () => {
    const layer = scoped().last;
    const rule = layer?.type === "atrule" ? layer.first : undefined;
    expect([layer?.source?.input.file, rule?.source?.input.file]).toEqual([
      expect.stringMatching(/tailwind\.css$/u),
      expect.stringMatching(/tailwind\.css$/u),
    ]);
  });
});

describe("scopeTailwindProperties without Tailwind's internals", () => {
  it("leaves the sheet as it was", () => {
    const css = ".jsnb-ov { color: red; }";
    expect(postcss([scopeTailwindProperties(options)]).process(css, { from: undefined }).css).toBe(
      css,
    );
  });
});
