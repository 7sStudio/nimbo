// The gate's rules on selectors and at-rules, each with sheets it must refuse and sheets it must pass, in the scope of
// ./repository.ts, as ./valueCases.ts does for declarations.
import type { Case } from "./valueCases.js";

export const selectorCases: readonly Case[] = [
  {
    rule: "selector-pseudo-class-disallowed-list",
    refused: [
      ".x\\:a:focus { outline-color: var(--accent); }",
      ".x\\:a:focus-within { outline-color: var(--accent); }",
      ".x\\:a:is(:focus) { outline-color: var(--accent); }",
    ],
    passed: [".x\\:a:focus-visible, .x\\:b:has(:focus-visible) { outline-color: var(--accent); }"],
  },
  {
    rule: "at-rule-allowed-list",
    refused: [
      "@property --tw-x { syntax: '*'; inherits: false; }",
      "@keyframes spin { to { rotate: 1turn; } }",
      "@font-face { font-family: X; src: url('x.woff2'); }",
      "@scope (body) { p { color: var(--fg); } }",
      "@starting-style { .x\\:a { opacity: 0; } }",
    ],
    passed: [
      "@layer utilities { @supports (display: grid) { .x\\:a { display: grid; } } }",
      "@container (width < 34rem) { .x\\:a { opacity: 1; } }",
    ],
  },
  {
    rule: "jsnb/in-scope",
    refused: [
      ".x\\:a + p { color: var(--fg); }",
      "body:has(.x\\:a) { overflow: clip; }",
      ":is(.app, body) p { color: var(--fg); }",
      ":where(.app, html) * { color: var(--fg); }",
      ".app td { padding-block: 0.25rem; }",
      ".app [data-part='tools'] { opacity: 0; }",
      ".x\\:\\[\\&_button\\]\\:c button { cursor: pointer; }",
      "p:not([data-user], [data-user] *) { color: var(--fg); }",
      ".app + p:not([data-user], [data-user] *) { color: var(--fg); }",
      ":is(.app, body) p:not([data-user], [data-user] *) { color: var(--fg); }",
      ".app div:not([data-user] *) { white-space: nowrap; }",
      ".app *:not([data-user] *) { cursor: pointer; }",
      "@supports (display: grid) { * { color: var(--fg); } }",
    ],
    passed: [
      ".app { color: var(--fg); } .x\\:a::before { content: ''; } .x\\:a + .x\\:b { gap: 0; }",
      ".app :is(button, a):not([data-user], [data-user] *):focus-visible { outline-offset: 1px; }",
      ".app > .row:not([data-user]):not([data-user] *) { margin-block: 0; }",
      ":is(.app) .x\\:a .y:not([data-user], [data-user] *) { margin-block: 0; }",
    ],
  },
  {
    rule: "jsnb/in-its-place",
    refused: [
      ".x\\:a { transition: opacity var(--dur) var(--ease-out); }",
      ".x\\:a { animation: spin 1s linear infinite; }",
      ".x\\:a { scroll-behavior: smooth; }",
      "@media not (prefers-reduced-motion: reduce) { .x\\:a { transition: opacity 1s; } }",
      ".x\\:a { position: fixed; }",
      ".x\\:a:hover { color: var(--fg); }",
      "@media (hover: hover) { .x\\:a:hover { color: var(--fg); } }",
      "@media (hover: hover) and (pointer: fine), print { .x\\:a:hover { color: var(--fg); } }",
      ".x\\:a { all: unset; }",
      ".x\\:a:focus-visible { all: unset; }",
      ".x\\:a { all: initial; }",
      ".x\\:live-slot { all: unset; }",
      ".x\\:live-slot, .x\\:b { all: initial; }",
    ],
    passed: [
      ".x\\:live-slot { all: initial; display: block; color-scheme: inherit; }",
      "@media (prefers-reduced-motion: no-preference) { .x\\:a { transition: opacity 1s; scroll-behavior: smooth; } }",
      ".x\\:a { transition-property: none; animation: none; } .x\\:fixed { position: fixed; }",
      "@media (hover: hover) and (pointer: fine) { .x\\:a:is(:where(.x\\:g):hover *) { color: var(--fg); } }",
    ],
  },
  {
    rule: "jsnb/relative-queries",
    refused: [
      "@container (min-width: 600px) { .x\\:a { display: none; } }",
      "@container (width > 2in) { .x\\:a { display: none; } }",
    ],
    passed: ["@container (width < 34rem) { .x\\:a { display: none; } }"],
  },
];
