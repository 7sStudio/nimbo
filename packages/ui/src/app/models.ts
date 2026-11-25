// The shell's view models: what the top bar, the banners and the status bar show, as plain
// values a component renders and a component test builds by hand. app/useShell.ts derives them from the stores.
import type { KernelState } from "@jsnb/core";

type SaveDot = "saved" | "writing" | "failed" | "conflict";

export type TopBarModel = {
  readonly folder: string;
  /** The Home page's address, the folder's link. */
  readonly home: string;
  readonly file: string;
  readonly save: SaveDot;
  readonly staleCount: number;
  /** A run is going, in the kernel or in the page, or waits in the queue: interrupt is enabled. */
  readonly busy: boolean;
  /** Runs are off: a view-only tab, no live socket, this tab not holding the page, or the notebook closed. */
  readonly runsOff: boolean;
  /** The command palette is open (the command input's aria-expanded). */
  readonly paletteOpen: boolean;
  /** The restart menu is open from the restart icon (its aria-expanded). */
  readonly restartOpen: boolean;
  /** Which of the three regions show: the top bar's switches. */
  readonly regions: {
    readonly side: boolean;
    readonly bottom: boolean;
    readonly inspector: boolean;
  };
};

export type ClusterModel = {
  /** "stopped": the notebook is closed, so is its kernel. */
  readonly kernel: KernelState | "unknown" | "stopped";
  readonly exit: string | null;
  /** The kernel process's pid, for the tooltip; null when none runs. */
  readonly pid: number | null;
  /** The restart menu is open from the cluster (its halves' aria-expanded). */
  readonly menuOpen: boolean;
  /** How long the running cell has run ("12.4 s") while the kernel is busy; null otherwise. */
  readonly elapsed: string | null;
  /** The kernels' Node as major.minor ("26.7"), shown beside the kernel's words; null while unknown or no kernel. */
  readonly node: string | null;
  readonly page:
    "attached" | "none" | "viewOnly" | "connecting" | "reconnecting" | "closed" | "waiting";
};

export type BannerTone = "error" | "warn" | "neutral" | "accent";

type BannerAction = {
  readonly label: string;
  readonly command: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly primary?: boolean;
};

export type BannerModel = {
  readonly id:
    | "notConnected"
    | "reconnecting"
    | "notebookClosed"
    | "kernelExited"
    | "saveFailed"
    | "conflict"
    | "noPage"
    | "viewOnly"
    | "installing";
  readonly tone: BannerTone;
  readonly title: string;
  readonly text: string;
  readonly detail?: string;
  readonly actions: readonly BannerAction[];
};

/** The status bar: what is running on the left, where the user is on the right. */
export type StatusModel = {
  /** The Node the kernels run on, as workspace.info says it (`26.7.0`, `unknown`); "" before it is known. */
  readonly node: string;
  readonly routes: number;
  /** Cells execution.autoRunDependents runs now or still has to run; 0 when no cascade is under way. */
  readonly autoRun: number;
  /** Runs are off in this tab (view only, no live socket): the cascade's stop is off too. */
  readonly runsOff: boolean;
  /** The problems as VS Code's status bar counts them: errors (cells whose last run failed and the editor's error
   * diagnostics) and warnings; together they make the Problems tab's count. The item opens the Problems tab, or hides
   * it while it shows. */
  readonly errors: number;
  readonly warnings: number;
  /** The bottom panel shows Problems now. */
  readonly problemsShown: boolean;
  /** The bottom panel shows: the panel toggle's pressed state. */
  readonly bottom: boolean;
  /** Command or edit mode, with the selected cell's type for the keys that matter in it. */
  readonly mode: "command" | "edit";
  /** The selected cell's place ("Cell 3 of 5") and language, or null when none is selected. */
  readonly cell: { readonly number: number; readonly of: number; readonly language: string } | null;
  /** Fold All folded every cell to its header. */
  readonly folded: boolean;
  /** The caret in the edited cell, 1-based; null in command mode. */
  readonly caret: { readonly line: number; readonly column: number } | null;
};

/** "exit code 1" or "signal SIGKILL" for a kernel that died on its own; null otherwise. */
export function exitOf(kernel: {
  readonly exitCode?: number;
  readonly signal?: string;
}): string | null {
  if (kernel.exitCode !== undefined) return `exit code ${String(kernel.exitCode)}`;
  if (kernel.signal !== undefined) return `signal ${kernel.signal}`;
  return null;
}

/** A running time as the cluster says it: tenths of a second under a minute, then minutes and seconds. */
export function elapsedText(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60))} min ${String(whole % 60).padStart(2, "0")} s`;
}

/** When the running cell's run started, as the cluster counts from it: only while the kernel is busy and the socket is
 * live, since a run that ended while the socket was away would otherwise keep counting until it is back. */
export function runStartOf(run: {
  readonly busy: boolean;
  readonly live: boolean;
  readonly startedAt: string | undefined;
}): number | null {
  if (!run.busy || !run.live) return null;
  const started = Date.parse(run.startedAt ?? "");
  return Number.isNaN(started) ? null : started;
}

/** "26.7" of "26.7.0", the cluster's short form of the kernels' Node; null for "", "unknown" or no
 * version at all. */
export function shortNode(version: string): string | null {
  const [major, minor] = version.split(".");
  return major !== undefined && minor !== undefined && /^\d+$/u.test(major)
    ? `${major}.${minor}`
    : null;
}

/** The last segment of a path, either separator: the breadcrumb's folder. */
export const baseName = (path: string): string =>
  path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;

/** "1 agent edit", "3 agent edits". */
export const plural = (count: number, word: string): string =>
  `${String(count)} ${word}${count === 1 ? "" : "s"}`;

/** An install's progress line: the package manager's last line that is not one of its own config warnings, which
 * depend on the machine, not on the install. */
export const progressLine = (lines: readonly string[]): string | null =>
  lines.filter((line) => !/^\s*npm warn\b.*\bconfig\b/iu.test(line)).at(-1) ?? null;

/** The page dot: while this tab's own attach has not settled it reads "connecting", whoever holds the page, so a
 * second tab never reads attached on the strength of another tab's page; a notebook another client
 * closed has no page to hold, and the tab waits for it to open again. */
export function pageOf(facts: {
  readonly connection: "connecting" | "live" | "reconnecting" | "closed" | "viewOnly";
  readonly closed: boolean;
  readonly attach: "pending" | "attached" | "viewOnly" | "failed";
  /** Some tab holds the notebook's page (the mirror's realm.attached). */
  readonly attached: boolean;
}): ClusterModel["page"] {
  if (facts.connection !== "live") return facts.connection;
  if (facts.closed) return "waiting";
  if (facts.attach === "pending") return "connecting";
  return facts.attached ? "attached" : "none";
}
