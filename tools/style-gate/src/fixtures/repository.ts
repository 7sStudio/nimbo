// The gate's tests' setting: a scope unlike output-view's, so nothing in the gate leans on .jsnb-ov, and the rules the
// repository's stylelint.config.js gives a package's CSS files (output-view's px list among them), with its ignoreFiles,
// so a test shows the gate is not ignored for them.
import { fileURLToPath } from "node:url";

import type { Config } from "stylelint";

import type { GateScope } from "../scope.js";

export const scope: GateScope = {
  root: "app",
  prefix: "x",
  live: "[data-user]",
  defaults: [":where(.app)", ":where(.app)::before", ":where(.app)::after"],
};

/** The defaults rule's selectors as a sheet writes them. */
export const defaults = scope.defaults.join(", ");

/** stylelint.config.js's rules for output-view's CSS files, as the gate reuses them. */
export const repositoryRules: NonNullable<Config["rules"]> = {
  "color-no-hex": true,
  "color-named": "never",
  "declaration-no-important": true,
  "declaration-property-value-disallowed-list": { outline: ["none", "0"] },
  "unit-disallowed-list": [
    ["px"],
    {
      ignoreProperties: {
        px: ["/^border(?!.*radius)/", "/^outline/", "box-shadow", "--shadow"],
      },
    },
  ],
};

export const repository = {
  file: fileURLToPath(new URL("dist/style.css", import.meta.url)),
  config: {
    ignoreFiles: ["**/dist/**"],
    rules: repositoryRules,
  },
};
