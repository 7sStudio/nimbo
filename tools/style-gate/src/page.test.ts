// Tests the gate on a page's own sheet (GateScope.page, rules/pageLevel.ts): the tokens on :root, the bundled fonts and
// the prefixed keyframes pass, and anything else that reaches the page is refused; a viewer's scope refuses all three.
import { beforeAll, describe, expect, it } from "vitest";

import { repository, scope } from "./fixtures/repository.js";
import { styleGate } from "./gate.js";

const page = styleGate({ ...scope, page: { fonts: ["Geist"], keyframes: "app-" } }, repository);
const viewer = styleGate(scope, repository);

// The gates' first calls resolve the repository's configuration: setup, not any one test's time.
beforeAll(() => Promise.all([page(""), viewer("")]));

const rules = async (gate: typeof page, css: string): Promise<string[]> =>
  (await gate(css)).map((fault) => fault.rule);

const reaching = [
  ':root { color-scheme: light dark; --bg: var(--x); } :root[data-theme="dark"] { color-scheme: dark; }',
  "@supports (color: color-mix(in lab, red, red)) { :root { --soft: oklch(50% 0.1 260 / 12%); --hex: #fff; } }",
  "@font-face { font-family: Geist; src: url('g.woff2'); font-display: swap; }",
  "@font-face { font-family: \"Geist\"; src: url('g.woff2'); }",
  "@keyframes app-spin { to { rotate: 1turn; } }",
];
const allowed = [
  ...reaching,
  "@media (prefers-reduced-motion: no-preference) { .x\\:a { animation: app-spin 1s linear infinite; } }",
];

describe("a page's sheet", () => {
  it.each(allowed)("passes %s", async (css) => {
    expect(await page(css)).toEqual([]);
  });

  it.each([
    [":root { color: var(--fg); }", "jsnb/page-level"],
    [":root, body { --bg: var(--x); }", "jsnb/in-scope"],
    [":root[data-mode] { --bg: var(--x); }", "jsnb/page-level"],
    ["@font-face { font-family: Inter; src: url('i.woff2'); }", "jsnb/page-level"],
    ["@font-face { src: url('i.woff2'); }", "jsnb/page-level"],
    ["@keyframes spin { to { rotate: 1turn; } }", "jsnb/page-level"],
    ["@property --tw-x { syntax: '*'; inherits: false; }", "at-rule-allowed-list"],
  ])("refuses %s under %s", async (css, rule) => {
    expect(await rules(page, css)).toContain(rule);
  });
});

describe("a viewer's sheet", () => {
  it.each(reaching)("refuses %s", async (css) => {
    expect((await viewer(css)).length).toBeGreaterThan(0);
  });
});
