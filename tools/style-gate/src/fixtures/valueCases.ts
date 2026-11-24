// The gate's rules on declarations, each with sheets it must refuse and sheets it must pass, in the scope of.
// /repository.ts (.app, x:, [data-user]), output-view's own cases among them.
// A sheet the gate passes has no fault of any rule.
import { defaults } from "./repository.js";

export type Case = {
  readonly rule: string;
  readonly refused: readonly string[];
  readonly passed: readonly string[];
};

export const valueCases: readonly Case[] = [
  {
    rule: "color-named",
    refused: [
      ".x\\:a { color: red; }",
      ".x\\:a { color: var(--fg, red); }",
      ".x\\:a { color: color-mix(in oklch, var(--fg) 50%, white); }",
      ".x\\:a { color: light-dark(black, white); }",
      ".x\\:a { --tw-shadow: 0 0 0 0.25rem red; }",
      `@layer utilities { ${defaults} { --tw-x: 0; color: red; } }`,
      "@layer utilities { .x\\:a, .x\\:b, .x\\:c { --tw-ring-color: red; } }",
      "/* stylelint-disable */ .x\\:a { color: red; }",
    ],
    passed: [
      '.x\\:a { color: var(--fg); font-family: "Tan", system-ui; list-style-type: circle; }',
      ".x\\:a { color: CanvasText; border-color: light-dark(var(--a), var(--b)); }",
    ],
  },
  {
    rule: "color-no-hex",
    refused: [
      ".x\\:a { color: #ff0000; }",
      ".x\\:a { color: var(--fg, #f00); }",
      ".x\\:a { --tw-shadow-color: #ff0000; }",
      ".x\\:a { color: #0000ff; }",
      ".x\\:a { background-color: #00000080; }",
      `${defaults} { --tw-ring-offset-color: #fff; }`,
      // only the defaults rule itself is left out: its selectors, all of them, in the utilities layer
      `@layer components { ${defaults} { --tw-ring-offset-color: #fff; } }`,
      "@layer utilities { .x\\:a, .x\\:b, .x\\:c { --tw-ring-offset-color: #fff; } }",
      "@layer utilities { :where(.app), :where(.app)::before, .x\\:c { --tw-ring-offset-color: #fff; } }",
      "@layer utilities { .x\\:a { --tw-shadow: 0 0 0 1px #f00; } }",
    ],
    passed: [
      `@layer utilities { ${defaults} { --tw-shadow: 0 0 #0000; --tw-ring-offset-color: #fff; } }`,
      ".x\\:a { background: #0000; box-shadow: 0 0 #00000000; }",
    ],
  },
  {
    rule: "function-disallowed-list",
    refused: [
      ".x\\:a { background-color: rgb(255 0 0); }",
      ".x\\:a { border-color: oklch(0.5 0.2 30); }",
      ".x\\:a { --tw-ring-color: rgb(255 0 0); }",
    ],
    passed: [".x\\:a { color: color-mix(in oklch, var(--fg) 6%, transparent); }"],
  },
  {
    rule: "declaration-no-important",
    refused: [
      ".x\\:a { --tw-shadow: 0 0 #0000 !important; }",
      "@media (hover: hover) and (pointer: fine) { .x\\:a:hover { color: var(--fg) !important; } }",
    ],
    passed: [".x\\:a { --tw-shadow: 0 0 #0000; }"],
  },
  {
    rule: "csstools/use-logical",
    refused: [
      ".x\\:a { left: 0.25rem; }",
      ".x\\:a { position: sticky; left: 0; }",
      ".x\\:a { text-align: left; }",
      ".x\\:a { width: 1rem; }",
    ],
    passed: [".x\\:a { inset-inline-start: 0.25rem; text-align: start; inline-size: 1rem; }"],
  },
  {
    rule: "property-disallowed-list",
    refused: [
      ".x\\:a { scroll-margin-top: 1rem; }",
      ".x\\:a { overscroll-behavior-x: contain; }",
      ".x\\:a { overscroll-behavior-y: none; }",
    ],
    passed: [".x\\:a { scroll-margin-block-start: 1rem; overscroll-behavior-inline: contain; }"],
  },
  {
    rule: "declaration-property-max-values",
    refused: [
      ".x\\:a { margin: 0 1rem; }",
      ".x\\:a { border-radius: 0.25rem 0 0 0.25rem; }",
      ".x\\:a { overscroll-behavior: contain auto; }",
    ],
    passed: [
      ".x\\:a { margin: calc(var(--x) * 2); inset: min(1rem, 2vw); padding: clamp(0.25rem, 1vw, 1rem); }",
      ".x\\:a { border-color: color-mix(in oklch, var(--fg) 20%, var(--bg)); border-radius: var(--r); }",
      ".x\\:a { inset-inline: 0 auto; margin-inline: 0 auto; overscroll-behavior: contain; }",
    ],
  },
  {
    rule: "unit-disallowed-list",
    refused: [
      ".x\\:a { border-radius: 6px; }",
      ".x\\:a { gap: 3px; }",
      ".x\\:a { font-size: 13px; }",
      ".x\\:a { line-height: 20px; }",
      ".x\\:a { letter-spacing: 1px; }",
      ".x\\:a { translate: 0 10px; }",
      ".x\\:a { --tw-translate-y: 10px; }",
      ".x\\:a { inline-size: 12pt; }",
      ".x\\:a { gap: 1cm; }",
      "@media (min-width: 600px) { .x\\:a { display: none; } }",
    ],
    passed: [
      ".x\\:a { border-inline-start-width: 20px; outline: 2px solid var(--accent); stroke-width: 2px; }",
      ".x\\:a { box-shadow: 0 0 0 2.5rem var(--accent); --tw-shadow: inset 2px 0 0 var(--accent); }",
      ".x\\:a { --shadow: 0 0 0 1px var(--accent); }",
    ],
  },
  {
    rule: "declaration-property-value-disallowed-list",
    refused: [
      ".x\\:a:focus-visible { outline: none; }",
      ".x\\:a { outline: 0; }",
      ".x\\:a { outline: 0 solid var(--accent); }",
      ".x\\:a { outline-style: none; }",
      ".x\\:a { outline-width: 0; }",
      ".x\\:a { overflow: hidden auto; }",
      ".x\\:a { overflow-x: hidden; }",
      ".x\\:a { scroll-snap-type: x mandatory; }",
      ".x\\:a { scroll-snap-type: y var(--tw-scroll-snap-strictness); }",
    ],
    passed: [
      ".x\\:a { outline: 2px solid var(--accent); overflow: clip; scroll-snap-type: inline mandatory; }",
      ".x\\:a { scroll-snap-type: block; }",
    ],
  },
  {
    rule: "declaration-property-value-allowed-list",
    refused: [
      ".x\\:a { z-index: 1; }",
      ".x\\:a { z-index: calc(var(--z-panel) + 1); }",
      ".x\\:a { z-index: var(--z-panel, 999); }",
    ],
    passed: [".x\\:a { z-index: var(--z-overlay); }"],
  },
];
