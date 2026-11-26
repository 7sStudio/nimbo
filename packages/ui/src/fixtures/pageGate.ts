// The style gate (@jsnb/style-gate, tools/style-gate) as the ui runs it on its built stylesheet: the page's scope
// (.jsnb-ui, its ui: utilities, a client cell's live slot, the scope plugin's defaults rule), what a page alone may set
// (its tokens on :root, its two bundled font families, its jsnb-ui-* keyframes), and the rules the repository's
// stylelint.config.js gives the package's CSS files.
import { fileURLToPath } from "node:url";

import { styleGate } from "@jsnb/style-gate";
import { defaultsSelectors } from "@jsnb/style-gate/tailwind-scope";

import { pageScope } from "../../pageScope.js";

export const faults = styleGate(
  {
    root: pageScope.scope.replace(/^\./u, ""),
    prefix: "ui",
    live: pageScope.except,
    defaults: defaultsSelectors(pageScope),
    page: { fonts: ["Geist", "JetBrains Mono"], keyframes: "jsnb-ui-" },
  },
  { file: fileURLToPath(new URL("../theme/reset.css", import.meta.url)) },
);

/** The same gate as output-view runs on its own sheet (its viewerGate fixture), for the copy the page build ships: the
 * viewer's scope, its ov: utilities and live slot, the rules its CSS files get. */
export const viewerFaults = styleGate(
  {
    root: "jsnb-ov",
    prefix: "ov",
    live: "[data-live]",
    defaults: defaultsSelectors({ scope: ".jsnb-ov", except: "[data-live]" }),
  },
  { file: fileURLToPath(new URL("../../../output-view/src/vue/chrome.css", import.meta.url)) },
);
