// The shell's view models from the stores: derived with computed, never stored, so a component
// renders plain values and its test builds them by hand (09-testing §1.3).
import { computed } from "vue";

import { homePageUrl } from "../store/address.js";
import { useNotebookStore } from "../store/notebook.js";
import type { Overlay, RestartFrom } from "../store/overlay.js";
import { useUiStore } from "../store/ui.js";
import { useWorkspaceStore } from "../store/workspace.js";
import { useLongWait } from "../composables/useLongWait.js";
import { useNow } from "../composables/useNow.js";
import { bannersOf } from "./bannerList.js";
import { failureName } from "./startFailure.js";
import type { ClusterModel, StatusModel, TopBarModel } from "./models.js";
import {
  baseName,
  elapsedText,
  exitOf,
  pageOf,
  progressLine,
  runStartOf,
  shortNode,
} from "./models.js";

/** How long a reconnect may take before the shell says what to do if the daemon is gone (a daemon restart and the
 * client's backoff are well under it). */
const longReconnectMs = 15_000;

/** How often a running cell's elapsed time is redrawn. */
const tickMs = 100;

type Notebook = ReturnType<typeof useNotebookStore>;
type Workspace = ReturnType<typeof useWorkspaceStore>;
type Ui = ReturnType<typeof useUiStore>;

/** The kernel half of the cluster; a closed socket hears nothing more of the kernel, so its last state would be a
 * guess and reads unknown; a notebook another client closed has its kernel stopped. */
function kernelOf(notebook: Notebook): Pick<ClusterModel, "kernel" | "exit" | "pid"> {
  const kernel = notebook.mirror.notebook?.kernel;
  if (kernel === undefined || notebook.connection === "closed")
    return { kernel: "unknown", exit: null, pid: null };
  if (notebook.mirror.closed) return { kernel: "stopped", exit: null, pid: null };
  return {
    kernel: kernel.state,
    exit: exitOf(kernel),
    pid: kernel.state === "dead" ? null : kernel.pid,
  };
}

/** Runs are off unless the socket is live, this tab holds the page and the notebook is open: the dispatcher's rule. */
export const runsOff = (notebook: Notebook): boolean =>
  notebook.connection !== "live" || notebook.attach.state !== "attached" || notebook.mirror.closed;

/** When the running cell's run started (its execution's startedAt), while the kernel is busy with one. */
function runStart(notebook: Notebook): number | null {
  const cell = notebook.runningCell;
  return runStartOf({
    busy: notebook.mirror.notebook?.kernel.state === "busy" && cell !== null,
    live: notebook.connection === "live" || notebook.connection === "viewOnly",
    startedAt: cell === null ? undefined : notebook.lastExecutionOf(cell)?.startedAt,
  });
}

/** What the banners read: the kernel's exit, the save state, the connection, the realm, an install. */
function bannerFacts(notebook: Notebook, workspace: Workspace, reconnectingLong: boolean) {
  const failure = notebook.startFailure;
  const state = notebook.mirror.notebook;
  const install = workspace.installing;
  const own = notebook.attach;
  return {
    failure: failureName(failure),
    stopped: failure !== null,
    notebook: notebook.pageName,
    reconnectingLong,
    closed: notebook.mirror.closed,
    // this tab's own attach: its state, a refusal's message, and whether it was taken over
    ownAttach: own.state,
    takenOver: own.state === "viewOnly" && own.takenOver === true,
    attachError: own.state === "failed" ? own.message : null,
    kernelExit: state?.kernel.state === "dead" ? (exitOf(state.kernel) ?? "") : null,
    save: notebook.mirror.saveState,
    saveError: notebook.mirror.saveError?.message ?? null,
    recovered: notebook.mirror.recovered,
    connection: notebook.connection,
    pageAttached: state?.realm.attached ?? true,
    installing:
      install === null
        ? null
        : { names: install.names, line: progressLine(install.lines), action: install.action },
  };
}

const languages = { server: "TypeScript", client: "TypeScript", markdown: "Markdown" } as const;

/** The language service's warnings over the cells there are. */
const warningsOf = (notebook: Notebook): number =>
  notebook.cellsInOrder.reduce(
    (sum, cell) =>
      sum +
      (notebook.mirror.diagnostics.get(cell.id) ?? []).filter(
        (diagnostic) => diagnostic.severity === "warning",
      ).length,
    0,
  );

function statusOf(notebook: Notebook, workspace: Workspace, ui: Ui): StatusModel {
  const cells = notebook.cellsInOrder;
  const at = cells.findIndex((cell) => cell.id === ui.selected);
  const selected = cells[at];
  return {
    node: workspace.info?.nodeVersion ?? "",
    routes: notebook.mirror.routes.length,
    autoRun:
      notebook.mirror.autoRun.pending.length + (notebook.mirror.autoRun.running === null ? 0 : 1),
    runsOff: runsOff(notebook),
    // the Problems tab's count split as VS Code's status bar splits it: errors + warnings is the tab's number
    errors: notebook.errors.length + notebook.diagnosticCount - warningsOf(notebook),
    warnings: warningsOf(notebook),
    problemsShown: ui.layout.bottom.open && ui.layout.bottom.tab === "problems",
    bottom: ui.layout.bottom.open,
    mode: ui.mode,
    cell:
      selected === undefined
        ? null
        : { number: at + 1, of: cells.length, language: languages[selected.type] },
    folded: ui.foldAll,
    caret:
      ui.mode === "edit" && ui.caretAt !== null && ui.caretAt.cell === ui.selected
        ? { line: ui.caretAt.line, column: ui.caretAt.column }
        : null,
  };
}

/** Where the open restart menu was opened from, or null when it is not open. */
const restartFrom = (overlay: Overlay | null): RestartFrom | null =>
  overlay?.kind === "restartMenu" ? overlay.from : null;

export function useShell() {
  const notebook = useNotebookStore();
  const workspace = useWorkspaceStore();
  const ui = useUiStore();
  const state = computed(() => notebook.mirror.notebook);
  const reconnectingLong = useLongWait(
    () => notebook.connection === "reconnecting",
    longReconnectMs,
  );

  const topBar = computed<TopBarModel>(() => ({
    folder: baseName(workspace.info?.root ?? ""),
    home: homePageUrl(location),
    file: state.value?.path ?? "",
    save: notebook.mirror.saveState,
    staleCount: notebook.staleCount,
    // the kernel runs a cell, or the page runs a client cell, or a run waits behind one (a cell run again while its run
    // goes on reads queued): interrupt ends the running one and clears the queue (02-architecture §5)
    busy:
      state.value?.kernel.state === "busy" ||
      notebook.cellsInOrder.some((cell) => cell.status === "running" || cell.status === "queued"),
    runsOff: runsOff(notebook),
    paletteOpen: ui.palette.open,
    restartOpen: restartFrom(ui.overlay) === "button",
    regions: {
      side: ui.layout.side.open,
      bottom: ui.layout.bottom.open,
      inspector: ui.layout.inspector.open,
    },
  }));
  // the kernel cluster's model, with the running cell's elapsed time redrawn while it runs
  const started = computed(() => runStart(notebook));
  const now = useNow(() => started.value !== null, tickMs);
  const cluster = computed<ClusterModel>(() => ({
    ...kernelOf(notebook),
    elapsed: started.value === null ? null : elapsedText(now.value - started.value),
    node: shortNode(workspace.info?.nodeVersion ?? ""),
    menuOpen: restartFrom(ui.overlay) === "cluster",
    page: pageOf({
      connection: notebook.connection,
      closed: notebook.mirror.closed,
      attach: notebook.attach.state,
      attached: notebook.mirror.notebook?.realm.attached ?? false,
    }),
  }));
  const banners = computed(() =>
    bannersOf(bannerFacts(notebook, workspace, reconnectingLong.value)),
  );
  const status = computed(() => statusOf(notebook, workspace, ui));
  return { topBar, cluster, banners, status };
}
