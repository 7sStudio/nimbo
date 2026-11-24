// Home's Explorer panel in the page: each one's width (its stored size, else a default relative to the
// window, never more than its share of the window so the list keeps its columns), a dragged or keyed size held to that
// share, and the focus given to the activity bar's Explorer icon when the panel hides with the focus inside it.
import { nextTick, watch } from "vue";

import { remPx } from "../composables/useResize.js";
import { useHomeStore } from "../store/home.js";
import type { HomePanel } from "../store/homeLayout.js";

const share = { side: 0.3 } as const;
const widths = { side: "clamp(15rem, 18vw, 22rem)" } as const;

export function useHomePanels() {
  const home = useHomeStore();
  // Side effect: a panel hidden while the focus is inside it (its Hide, its key) gives the focus to the top bar's
  // switch that shows it again, never to <body>.
  for (const panel of ["side"] as const)
    watch(
      () => home.layout[panel].open,
      async (shown) => {
        if (shown || document.getElementById(panel)?.contains(document.activeElement) !== true)
          return;
        await nextTick();
        document.querySelector<HTMLElement>(`[data-switch="${panel}"]`)?.focus();
      },
      { flush: "pre" },
    );
  return {
    /** The panel's inline size: its stored size or default, within its share of the window. */
    widthOf: (panel: HomePanel) => {
      const size = home.layout[panel].size;
      const wanted = size === null ? widths[panel] : `${String(size)}rem`;
      return { inlineSize: `min(${wanted}, ${String(share[panel] * 100)}vw)` };
    },
    /** A dragged or keyed size, held to the panel's share of the window as it is now. */
    resize: (panel: HomePanel, rem: number | null) => {
      const most = (share[panel] * innerWidth) / remPx();
      home.resizePanel(panel, rem === null ? null : Math.min(rem, most));
    },
  };
}
