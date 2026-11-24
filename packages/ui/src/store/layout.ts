// The workbench's per-browser layout: three regions around the notebook, each open or hidden and resized by dragging
// the gap beside it. The side panel (left) holds what exists before the notebook runs (and Run and Debug, as VS Code), the inspector (right) what
// exists once it runs, the bottom panel the logs; the two categories never mix. Kept in localStorage under
// jsnb.ui.layout; a size is in rem and null until the user drags, when the CSS default applies.
const sideViews = ["explorer", "search", "sourceControl", "environment", "agent", "debug"] as const;
export type SideView = (typeof sideViews)[number];
const bottomTabs = ["console", "activity", "kernelLog", "problems"] as const;
export type BottomTab = (typeof bottomTabs)[number];
export type InspectorSection = "pinned" | "variables" | "bridge" | "routes";
export type Region = "side" | "inspector" | "bottom";

export type LayoutState = {
  readonly side: { readonly open: boolean; readonly view: SideView; readonly size: number | null };
  readonly inspector: { readonly open: boolean; readonly size: number | null };
  readonly bottom: {
    readonly open: boolean;
    readonly tab: BottomTab;
    readonly size: number | null;
  };
  /** The sections the user folded (false) or unfolded (true), by name. */
  readonly folds: Readonly<Record<string, boolean>>;
};

/** Where a named place is: a view of the side panel, a tab of the bottom panel, or a section of the inspector. */
export type Place =
  | { readonly region: "side"; readonly view: SideView }
  | { readonly region: "bottom"; readonly tab: BottomTab }
  | { readonly region: "inspector"; readonly section?: InspectorSection };

export const layoutKey = "jsnb.ui.layout";
/** Each region's bounds in rem: a width for the two sides, a height for the bottom panel. */
export const bounds: Readonly<Record<Region, { readonly min: number; readonly max: number }>> = {
  side: { min: 13, max: 28 },
  inspector: { min: 14, max: 32 },
  bottom: { min: 6, max: 30 },
};
export const defaultLayout: LayoutState = {
  side: { open: true, view: "explorer", size: null },
  inspector: { open: true, size: null },
  bottom: { open: false, tab: "console", size: null },
  folds: {},
};

/** The place a name means: a view, a tab or a section by its own name, and the panels' older names (a stored command, the palette, a link), each where its content went. */
const places: Readonly<Record<string, Place>> = {
  explorer: { region: "side", view: "explorer" },
  search: { region: "side", view: "search" },
  sourceControl: { region: "side", view: "sourceControl" },
  scm: { region: "side", view: "sourceControl" },
  environment: { region: "side", view: "environment" },
  packages: { region: "side", view: "environment" },
  secrets: { region: "side", view: "environment" },
  agent: { region: "side", view: "agent" },
  debug: { region: "side", view: "debug" },
  inspector: { region: "inspector" },
  pinned: { region: "inspector", section: "pinned" },
  variables: { region: "inspector", section: "variables" },
  bridge: { region: "inspector", section: "bridge" },
  routes: { region: "inspector", section: "routes" },
  console: { region: "bottom", tab: "console" },
  activity: { region: "bottom", tab: "activity" },
  problems: { region: "bottom", tab: "problems" },
  errors: { region: "bottom", tab: "problems" },
  kernelLog: { region: "bottom", tab: "kernelLog" },
};

/** The place `name` means, or undefined for a name that is none. */
export const placeOf = (name: unknown): Place | undefined =>
  typeof name === "string" && Object.hasOwn(places, name) ? places[name] : undefined;

/** A size kept within the region's bounds; anything that is not a finite number is the default. */
export const clampSize = (region: Region, size: unknown): number | null =>
  typeof size === "number" && Number.isFinite(size)
    ? Math.min(bounds[region].max, Math.max(bounds[region].min, size))
    : null;

/** The layout with `place` showing. */
export function opened(layout: LayoutState, place: Place): LayoutState {
  if (place.region === "side")
    return { ...layout, side: { ...layout.side, open: true, view: place.view } };
  if (place.region === "bottom")
    return { ...layout, bottom: { ...layout.bottom, open: true, tab: place.tab } };
  return { ...layout, inspector: { ...layout.inspector, open: true } };
}

/** True when `place` is what its region shows now. */
export function showing(layout: LayoutState, place: Place): boolean {
  if (place.region === "side") return layout.side.open && layout.side.view === place.view;
  if (place.region === "bottom") return layout.bottom.open && layout.bottom.tab === place.tab;
  return layout.inspector.open;
}

/** The layout with `region` open or hidden. */
export const withOpen = (layout: LayoutState, region: Region, open: boolean): LayoutState => ({
  ...layout,
  [region]: { ...layout[region], open },
});

/** The layout with the user's fold of the section `name`. */
export const withFold = (layout: LayoutState, name: string, open: boolean): LayoutState => ({
  ...layout,
  folds: { ...layout.folds, [name]: open },
});

const field = (from: unknown, key: string): unknown =>
  typeof from === "object" && from !== null ? Reflect.get(from, key) : undefined;
const oneOf = <T extends string>(all: readonly T[], value: unknown, fallback: T): T =>
  all.find((each) => each === value) ?? fallback;
const flag = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const foldsOf = (value: unknown): Readonly<Record<string, boolean>> =>
  typeof value === "object" && value !== null
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
        ),
      )
    : {};

/** The stored layout, or the default for anything missing, malformed or unreadable. */
export function readLayout(storage: Pick<Storage, "getItem"> | undefined): LayoutState {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(layoutKey) ?? "null");
    const part = (region: Region) => field(parsed, region);
    const base = (region: Region) => ({
      open: flag(field(part(region), "open"), defaultLayout[region].open),
      size: clampSize(region, field(part(region), "size")),
    });
    return {
      side: { ...base("side"), view: oneOf(sideViews, field(part("side"), "view"), "explorer") },
      inspector: base("inspector"),
      bottom: {
        ...base("bottom"),
        tab: oneOf(bottomTabs, field(part("bottom"), "tab"), "console"),
      },
      folds: foldsOf(field(parsed, "folds")),
    };
  } catch {
    return defaultLayout; // a malformed value or a storage that throws (private mode): the default
  }
}

/** Stores the layout; a storage that throws keeps the page working with an unsaved layout. */
export function writeLayout(
  storage: Pick<Storage, "setItem"> | undefined,
  state: LayoutState,
): void {
  try {
    storage?.setItem(layoutKey, JSON.stringify(state));
  } catch {
    // a full or blocked storage loses only this browser's layout
  }
}
