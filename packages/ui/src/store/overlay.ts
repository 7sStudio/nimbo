// The menus and dialogs other than the palette and full screen: at most one is open, and the page's
// keys belong to it while it is (keyboard/useShortcuts.ts). Each names what it acts on, never a DOM node: the overlay
// finds the control it opens from by its data attributes (overlays/anchor.ts).
import type { CellId } from "@jsnb/core";

/** A point in the viewport, in CSS pixels, where a right-click opened a menu. */
export type Anchor = { readonly x: number; readonly y: number };

/** Where the restart menu was opened from: the top bar's restart icon or the kernel cluster. */
export type RestartFrom = "button" | "cluster";

export type Overlay =
  | { readonly kind: "cellMenu"; readonly cell: CellId; readonly at: Anchor | null }
  /** `toCode` (Y): the menu offers server and client, for the marked markdown cells only. */
  | { readonly kind: "typeMenu"; readonly cell: CellId; readonly toCode?: true }
  | { readonly kind: "restartMenu"; readonly from: RestartFrom }
  /** The whole diff of the agent edit of `cell` no one reviewed yet (Open full diff). */
  | { readonly kind: "agentDiff"; readonly cell: CellId }
  /** The cell's last run against the one before it (cell.compare). */
  | { readonly kind: "runCompare"; readonly cell: CellId }
  /** Restarting while `running` runs asks first (Confirm); `all` restarts the page's realm too. */
  | { readonly kind: "confirmRestart"; readonly running: CellId; readonly all: boolean }
  /** Home asks before deleting a notebook and before closing one whose kernel is busy. */
  | { readonly kind: "confirmNotebook"; readonly action: "delete" | "close"; readonly path: string }
  /** Home's Open folder picker at `path` (the workspace folder without one); `confirm` asks at once whether to leave
   * the open notebooks (a recent folder chosen in the palette while notebooks are open). */
  | { readonly kind: "folderPicker"; readonly path?: string; readonly confirm?: true }
  /** Source Control asks before discarding changes, and before a commit with nothing staged stages everything. */
  | {
      readonly kind: "confirmGit";
      readonly action: "discard" | "commitAll";
      readonly paths: readonly string[];
    }
  /** The saved UI feedback (feedback mode's list), on either page. */
  | { readonly kind: "feedback" }
  /** Leaving the notebook for Home with changes not on disk asks first: Save, Don't Save or Cancel, as VS Code does. */
  | { readonly kind: "confirmLeave" }
  /** Closing Settings or leaving the page with unsaved Settings (JSON) text asks first: Save, Don't Save or Cancel;
   * the answer runs `command` again. */
  | {
      readonly kind: "confirmSettings";
      readonly command: string;
      readonly args?: Readonly<Record<string, unknown>>;
    }
  /** A language hint (hover, parameter hints, a completion's details) in full, from its expand button. */
  | { readonly kind: "hint"; readonly title: string; readonly html: string };
