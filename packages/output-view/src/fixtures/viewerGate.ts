// The 08 §7 gate (@jsnb/style-gate, tools/style-gate) as output-view runs it on its compiled stylesheets: the viewer's
// scope (.jsnb-ov, its ov: utilities, a DOM output's live slot, the scope plugin's defaults rule) and the rules the
// repository's stylelint.config.js gives the package's CSS files.
import { fileURLToPath } from "node:url";

import { styleGate } from "@jsnb/style-gate";

import { defaultsSelectors } from "@jsnb/style-gate/tailwind-scope";

import { viewerScope } from "../../tailwindScope.js";

export const faults = styleGate(
  {
    root: viewerScope.scope.replace(/^\./u, ""),
    prefix: "ov",
    live: viewerScope.except,
    defaults: defaultsSelectors(viewerScope),
  },
  { file: fileURLToPath(new URL("../vue/chrome.css", import.meta.url)) },
);
