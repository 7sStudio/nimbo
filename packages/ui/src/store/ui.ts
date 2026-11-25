// The page-only state (store/ui.ts): selection and mode, the workbench layout, the palette, full screen,
// the open menu or dialog, the agent-edit filter, the toasts, and the editor drafts a run sends. Nothing here is notebook state;
// a reload loses only this.
import type { CellId, CellMeta, CellType } from "@jsnb/core";
import { defineStore } from "pinia";
import type { Ref } from "vue";
import { reactive, ref, watch } from "vue";

import { foldState, pinState } from "./fold.js";
import type { Overlay } from "./overlay.js";
import type { InspectorSection, LayoutState, Place, Region } from "./layout.js";
import {
  clampSize,
  opened,
  readLayout,
  showing,
  withFold,
  withOpen,
  writeLayout,
} from "./layout.js";
import { toastQueue } from "./toasts.js";

export type Mode = "command" | "edit";
export type Filter = "all" | "agentEdits";
/** Where the caret goes when edit mode enters a cell: from a neighbour (↑ on the first line, ↓ on the last),
 * or onto a match the Search view found (its 1-based line and the 0-based columns it spans). */
export type Caret =
  "start" | "end" | { readonly line: number; readonly from: number; readonly to: number } | null;
/** A request to the selected cell's output: find (⌘F) or the query bar (⌘⇧F); `at` tells a repeat apart. */
export type OutputRequest = {
  readonly kind: "find" | "query";
  readonly cell: CellId;
  readonly at: number;
};

const storage = (): Storage | undefined =>
  typeof localStorage === "undefined" ? undefined : localStorage;

type SettingsScope = "user" | "workspace";
/** Settings (JSON)'s unsaved text per file, with the text it was edited from (to tell a change on disk since): kept
 * while the page lives, so a switch of file or view keeps it, and asked about before Settings closes or the page
 * leaves (overlays/SettingsLeaveDialog.vue), as VS Code asks about a dirty settings.json. */
function settingsDrafts() {
  const settingsUnsaved = ref<Partial<Record<SettingsScope, { text: string; base: string }>>>({});
  return {
    settingsUnsaved,
    /** The files whose text is unsaved. */
    settingsUnsavedScopes: (): SettingsScope[] =>
      (["user", "workspace"] as const).filter(
        (scope) => settingsUnsaved.value[scope] !== undefined,
      ),
    /** Drops `scope`'s unsaved text (written, reverted or discarded). */
    forgetSettings: (scope: SettingsScope) => {
      settingsUnsaved.value = Object.fromEntries(
        Object.entries(settingsUnsaved.value).filter(([key]) => key !== scope),
      );
    },
  };
}

/** What the diff page compares: a working file (staged: the index's side), a commit's change, or a commit against the
 * working tree (base). */
export type DiffTarget = {
  readonly path: string;
  readonly staged: boolean;
  readonly commit?: string;
  readonly base?: string;
};

/** The diff page's state. */
const diffState = () => ({
  /** The file the diff editor shows: its path and whether it is the index's side (Staged). */
  diff: ref<DiffTarget | null>(null),
  /** A step asked of the diff editor (Next or Previous Change); `at` tells a repeat apart. */
  diffStep: ref<{ readonly by: 1 | -1; readonly at: number } | null>(null),
});

/** The inspector section last asked for by name, `at` telling a repeat apart, and a name in it to open too (a
 * variable). */
type Revealed = { readonly section: InspectorSection; readonly at: number; readonly name?: string };

/** The inspector section last asked for by name (a link, the palette, the hidden inspector's icons, a value at a
 * line's end): the inspector brings it into view. */
function revealState() {
  const revealed = ref<Revealed | null>(null);
  const reveal = (place: Place, name?: string) => {
    if (place.region === "inspector" && place.section !== undefined)
      revealed.value = {
        section: place.section,
        at: (revealed.value?.at ?? 0) + 1,
        ...(name === undefined ? {} : { name }),
      };
  };
  return { revealed, reveal };
}

/** The workbench layout and its actions; every change is written to this browser's storage. */
function layoutState() {
  const layout = ref<LayoutState>(readLayout(storage()));
  /** What the main area shows instead of the notebook or Home's list: the Settings editor, as VS Code opens it in an
   * editor tab, or null. */
  const page = ref<"settings" | "keybindings" | "diff" | null>(null);
  /** The page's JSON view (Settings (JSON), Keyboard Shortcuts (JSON)) instead of its list; Cmd , and Cmd K Cmd S open
   * the list, as VS Code's do. */
  const pageJson = ref(false);
  const { revealed, reveal } = revealState();
  // Side effect: the layout is per browser, so every change is written to localStorage.
  watch(layout, (state) => {
    writeLayout(storage(), state);
  });
  return {
    layout,
    revealed,
    page,
    pageJson,
    /** Shows `place`, opening its region; `name` is an entry of it to open too (a variable). */
    openPlace: (place: Place, name?: string) => {
      layout.value = opened(layout.value, place);
      reveal(place, name);
    },
    /** Shows `place`, or hides its region when it is what the region shows now. */
    togglePlace: (place: Place) => {
      if (showing(layout.value, place)) layout.value = withOpen(layout.value, place.region, false);
      else {
        layout.value = opened(layout.value, place);
        reveal(place);
      }
    },
    /** Opens or hides a region, keeping what it showed; no `open` toggles it. */
    setRegion: (region: Region, open?: boolean) => {
      layout.value = withOpen(layout.value, region, open ?? !layout.value[region].open);
    },
    /** A size in rem, clamped to the region's bounds; null puts the CSS default back. */
    resizeRegion: (region: Region, rem: number | null) => {
      layout.value = {
        ...layout.value,
        [region]: { ...layout.value[region], size: clampSize(region, rem) },
      };
    },
    /** Keeps the user's fold of the section `name`, across views and reloads. */
    setFold: (name: string, open: boolean) => (layout.value = withFold(layout.value, name, open)),
  };
}

/** Selection and mode: edit mode needs a selected cell; `at` places the caret when it comes from a neighbour. A
 * range of cells is marked from `anchor` to the selected cell (⇧↑ and ⇧↓, as in Jupyter); any plain select ends it. */
function selection() {
  const selected = ref<CellId | null>(null);
  const anchor = ref<CellId | null>(null);
  const mode = ref<Mode>("command");
  const caret = ref<Caret>(null);
  const setMode = (next: Mode, at: Caret = null) => {
    mode.value = selected.value === null ? "command" : next;
    caret.value = mode.value === "edit" ? at : null;
  };
  return {
    selected,
    anchor,
    mode,
    caret,
    setMode,
    select: (cell: CellId | null) => {
      selected.value = cell;
      anchor.value = null;
      if (cell === null) setMode("command");
    },
    /** Moves the selection to `cell` keeping the range's other end where it was (in command mode). */
    extendTo: (cell: CellId) => {
      anchor.value ??= selected.value;
      selected.value = cell;
      setMode("command");
    },
  };
}

/** A copied cell, as C and X keep it for V and ⇧V: this page's own clipboard, as Jupyter's is. */
export type CopiedCell = {
  readonly type: CellType;
  readonly source: string;
  readonly meta: CellMeta;
};

/** Editor text the store does not have yet (the editor is the only optimistic state); a run sends it. Reactive,
 * so a view shows the draft until the cell's source catches up (cells/useDrafts.ts clears it then). */
function draftState() {
  const drafts = reactive(new Map<CellId, string>());
  return {
    /** CellEditor records its text here on every change; it is cleared once the cell's source equals it. */
    setDraft: (cell: CellId, source: string | null) => {
      if (source === null) drafts.delete(cell);
      else drafts.set(cell, source);
    },
    draftOf: (cell: CellId): string | undefined => drafts.get(cell),
    /** Set by the cell list (cells/useDrafts.ts): sends every unsent draft; the dispatcher awaits it before a command
     * that writes, so a run, a save or a restart never acts on a cell's older source. */
    flushDrafts: { run: (): Promise<unknown> => Promise.resolve() },
  };
}

/** Command ids, the one last chosen in the palette first (its "recently used first"); keys and clicks do not
 * count, or the keyboard's own moves would crowd the choices out. */
function recents(recent: Ref<readonly string[]>) {
  return (id: string) => {
    recent.value = [id, ...recent.value.filter((each) => each !== id)].slice(0, 20);
  };
}

export const useUiStore = defineStore("ui", () => {
  const palette = ref({ open: false, query: "" });
  const recent = ref<readonly string[]>([]);
  const chosen = selection();
  const layout = layoutState();
  const selects = ref(0);
  return {
    ...chosen,
    ...layout,
    ...diffState(),
    ...settingsDrafts(),
    /** Counts the selects, so going to the cell already selected reveals it again (cells/useFocusFollow.ts). */
    selects,
    /** Selects `cell`; going to a cell (the outline, Search, Problems, a Jump, the palette) closes an editor such as
     * Settings over the notebook, so the cell shows, as VS Code reveals a target in its own editor. */
    select: (cell: CellId | null) => {
      layout.page.value = null;
      chosen.select(cell);
      selects.value += 1;
    },
    /** Moves the selection without revealing it (the selected cell was deleted by an agent or another tab): an editor
     * such as Settings stays open over the notebook. */
    follow: (cell: CellId | null) => {
      chosen.select(cell);
    },
    ...toastQueue(),
    ...draftState(),
    ...foldState(),
    ...pinState(),
    palette,
    fullscreen: ref<{ readonly cell: CellId; readonly index: number } | null>(null),
    /** The open menu or dialog of store/overlay.ts, or null. */
    overlay: ref<Overlay | null>(null),
    filter: ref<Filter>("all"),
    outputRequest: ref<OutputRequest | null>(null),
    clipboard: ref<readonly CopiedCell[]>([]),
    recent,
    used: recents(recent),
    openPalette: (query = "") => {
      palette.value = { open: true, query };
    },
    closePalette: () => {
      palette.value = { open: false, query: "" };
    },
  };
});
