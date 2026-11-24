// Home's Explorer panel on the left, open or hidden and resized by dragging the gap beside it, kept per browser in localStorage under jsnb.ui.home; a size is in rem and
// null until the user drags, when the CSS default applies. The notebook page's own layout (layout.ts) is apart from it.
import { ref, watch } from "vue";

import { clampSize } from "./layout.js";

/** What Home's side panel shows: the Explorer or the Source Control view. */
export type HomeView = "explorer" | "sourceControl";
type PanelLayout = {
  readonly open: boolean;
  readonly size: number | null;
  readonly view: HomeView;
};
export type HomeLayout = { readonly side: PanelLayout };
export type HomePanel = keyof HomeLayout;

const layoutKey = "jsnb.ui.home";
/** The notebook page's region whose bounds each panel shares. */
const regionOf = { side: "side" } as const;
const storage = (): Storage | undefined =>
  typeof localStorage === "undefined" ? undefined : localStorage;
const field = (from: unknown, key: string): unknown =>
  typeof from === "object" && from !== null ? Reflect.get(from, key) : undefined;

/** Home's panel as this browser last left it; open at its default width otherwise. */
function readHomeLayout(): HomeLayout {
  const panel = (value: unknown, which: HomePanel): PanelLayout => ({
    open: field(value, "open") !== false,
    size: clampSize(regionOf[which], field(value, "size")),
    view: field(value, "view") === "sourceControl" ? "sourceControl" : "explorer",
  });
  try {
    const stored: unknown = JSON.parse(storage()?.getItem(layoutKey) ?? "null");
    return { side: panel(field(stored, "side"), "side") };
  } catch {
    return { side: { open: true, size: null, view: "explorer" } };
  }
}

/** The panel and its actions; every change is written to this browser's storage. */
export function homeLayout() {
  const layout = ref<HomeLayout>(readHomeLayout());
  // Side effect: the panels are per browser, so every change is written to localStorage.
  watch(layout, (value) => {
    try {
      storage()?.setItem(layoutKey, JSON.stringify(value));
    } catch {
      // a full or blocked storage loses only this browser's layout
    }
  });
  return {
    layout,
    togglePanel: (panel: HomePanel, open?: boolean) => {
      const now = layout.value[panel];
      layout.value = { ...layout.value, [panel]: { ...now, open: open ?? !now.open } };
    },
    /** Shows `view` in the side panel, or hides the panel when it shows `view` already (an activity bar click). */
    toggleView: (view: HomeView) => {
      const now = layout.value.side;
      const open = !(now.open && now.view === view);
      layout.value = { ...layout.value, side: { ...now, open, view } };
    },
    openView: (view: HomeView) => {
      layout.value = { ...layout.value, side: { ...layout.value.side, open: true, view } };
    },
    resizePanel: (panel: HomePanel, rem: number | null) => {
      const size = clampSize(regionOf[panel], rem);
      layout.value = { ...layout.value, [panel]: { ...layout.value[panel], size } };
    },
  };
}
