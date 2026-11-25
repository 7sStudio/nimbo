// The menus and dialogs other than the palette and full screen: at most one is open, and the page's
// keys belong to it while it is (keyboard/useShortcuts.ts). Each names what it acts on, never a DOM node: the overlay
// finds the control it opens from by its data attributes (overlays/anchor.ts).
import type { CellId } from "@jsnb/core";

/** A point in the viewport, in CSS pixels, where a right-click opened a menu. */
export type Anchor = { readonly x: number; readonly y: number };

/** Where the restart menu was opened from: the top bar's restart icon or the kernel cluster. */
export type RestartFrom = "button" | "cluster";

/** A command an overlay sends once answered. */
type Then = { readonly command: string; readonly args?: Readonly<Record<string, unknown>> };

/** One row of Source Control's quick pick: a branch, a remote branch, a stash, a remote, or an action. */
export type GitPickItem = Then & {
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
  readonly icon: "branch" | "remote" | "add" | "stash" | "repo";
  /** The group heading it shows under. */
  readonly group?: string;
};

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
  | { readonly kind: "hint"; readonly title: string; readonly html: string }
  /** Source Control's confirm of an action that can lose work, VS Code's wording; the action sends `command`. */
  | (Then & {
      readonly kind: "gitAsk";
      readonly title: string;
      readonly description: string;
      readonly button: string;
      readonly danger?: true;
    })
  /** Source Control's quick pick (Checkout to, Delete Branch, Pop Stash, a remote): a row sends its command. */
  | {
      readonly kind: "gitPick";
      readonly placeholder: string;
      readonly items: readonly GitPickItem[];
    }
  /** Source Control's input box (a branch name, a stash message): Enter sends `command` with the text as `key`. */
  | (Then & {
      readonly kind: "gitInput";
      readonly placeholder: string;
      readonly prompt: string;
      readonly key: string;
      readonly value?: string;
      /** An empty answer is sent too (a stash message). */
      readonly optional?: true;
    });
