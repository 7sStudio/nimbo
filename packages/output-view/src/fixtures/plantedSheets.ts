// Sheets in the viewer's own forms the 08 §7 gate must refuse in output-view's scope, each with the rule that refuses it
// (style.plants.contract.test.ts), and a sheet of what it must pass: the scope plugin's real defaults rule, chrome.css's
// exclusion of the live slot, and the dialog's fixed utility. The gate's own tests plant the rest on fixture CSS.
import { defaultsSelectors } from "@jsnb/style-gate/tailwind-scope";

import { viewerScope } from "../../tailwindScope.js";

/** The scope plugin's defaults rule's selectors, which the gate leaves out inside the utilities layer only. */
const defaults = defaultsSelectors(viewerScope).join(", ");

export const refusedSheets: readonly (readonly [string, string])[] = [
  // excluding only what the live slot holds still matches the slot, from which every inherited property reaches the
  // user's elements (mutation: white-space, cursor, text-align, text-transform, user-select)
  [".jsnb-ov div:not([data-live] *) { white-space: nowrap; }", "jsnb/in-scope"],
  [".jsnb-ov *:not([data-live] *) { cursor: pointer; }", "jsnb/in-scope"],
  [".jsnb-ov [data-part='tools'] { opacity: 0; }", "jsnb/in-scope"],
  [".jsnb-ov td { padding-block: 0.25rem; }", "jsnb/in-scope"],
  [".ov\\:a:focus-within { opacity: 1; }", "selector-pseudo-class-disallowed-list"],
  [".ov\\:a { overscroll-behavior-x: contain; }", "property-disallowed-list"],
  [".ov\\:a:focus-visible { all: unset; }", "jsnb/in-its-place"],
  [".ov\\:live-slot { all: unset; }", "jsnb/in-its-place"],
  [`${defaults} { --tw-ring-offset-color: #fff; }`, "color-no-hex"],
  [`@layer utilities { ${defaults} { --tw-x: 0; color: red; } }`, "color-named"],
];

export const allowedSheet = `
  @layer utilities { ${defaults} { --tw-shadow: 0 0 #0000; --tw-ring-offset-color: #fff; } }
  .jsnb-ov :is(button, a):not([data-live], [data-live] *):focus-visible { outline: 2px solid var(--accent); }
  @media (prefers-reduced-motion: no-preference) {
    .jsnb-ov [data-part="tools"]:not([data-live], [data-live] *) { transition: opacity var(--dur) var(--ease-out); }
  }
  .ov\\:live-slot { all: initial; display: block; color-scheme: inherit; -webkit-locale: inherit; }
  .ov\\:fixed { position: fixed; }`;
