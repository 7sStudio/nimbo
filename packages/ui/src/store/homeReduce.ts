// The Home page's mirror of the workspace: the notebook list as workspace.info gives it,
// replaced by each notebooks.changed, kept in step by notebook.opened and notebook.closed between them, and the kernel
// state of each open notebook from its kernel.status events, with the moment it turned busy (the Running section's
// elapsed time). A pure reducer over the workspace stream, tested against recorded logs as the notebook's (reduce.ts).
import type { EventEnvelope, KernelStatus, NotebookEntry } from "@jsnb/core";

export type HomeKernel = {
  readonly state: KernelStatus["state"];
  /** When the kernel turned busy (an event's or a run's ISO time); null while it is not busy, or not known. */
  readonly busySince: string | null;
};

export type HomeState = {
  /** Every notebook of the workspace, sorted by ref. */
  readonly notebooks: readonly NotebookEntry[];
  /** The kernel of each open notebook, by ref, once known. */
  readonly kernels: Readonly<Record<string, HomeKernel>>;
};

export const emptyHome: HomeState = { notebooks: [], kernels: {} };

/** The kernels of the notebooks still open in `notebooks`. */
function openKernels(
  notebooks: readonly NotebookEntry[],
  kernels: HomeState["kernels"],
): HomeState["kernels"] {
  const open = new Set(notebooks.filter((each) => each.open).map((each) => each.path));
  return Object.fromEntries(Object.entries(kernels).filter(([path]) => open.has(path)));
}

/** The state with `notebooks` as the list (workspace.info or notebooks.changed). */
export const withList = (state: HomeState, notebooks: readonly NotebookEntry[]): HomeState => ({
  notebooks,
  kernels: openKernels(notebooks, state.kernels),
});

/** The state with `path`'s kernel at `kernel` (a kernel.status, or one read when the page loads). */
export const withKernel = (state: HomeState, path: string, kernel: HomeKernel): HomeState => ({
  ...state,
  kernels: { ...state.kernels, [path]: kernel },
});

/** `path` opened or closed before the list that says so arrives; a notebook not listed yet joins it. */
function withOpen(state: HomeState, path: string, open: boolean): HomeState {
  const listed = state.notebooks.some((each) => each.path === path);
  const notebooks = listed
    ? state.notebooks.map((each) => (each.path === path ? { ...each, open } : each))
    : [...state.notebooks, { path, open, modifiedAt: null, bytes: null }].sort((a, b) =>
        a.path < b.path ? -1 : 1,
      );
  return withList(state, notebooks);
}

/** An open notebook whose file moved: it is open under `to`, with its kernel, before the list says so. */
function movedTo(state: HomeState, from: string, to: string): HomeState {
  const kernel = state.kernels[from];
  const next = withOpen(withOpen(state, from, false), to, true);
  const notebooks = next.notebooks.filter((each) => each.path !== from);
  const moved = withList(next, notebooks);
  return kernel === undefined ? moved : withKernel(moved, to, kernel);
}

/** The kernel after a kernel.status at `ts`: a busy kernel keeps the moment it turned busy. */
function nextKernel(
  previous: HomeKernel | undefined,
  status: KernelStatus,
  ts: string,
): HomeKernel {
  if (status.state !== "busy") return { state: status.state, busySince: null };
  return { state: "busy", busySince: previous?.busySince ?? ts };
}

const isOpen = (state: HomeState, path: string): boolean =>
  state.notebooks.some((each) => each.path === path && each.open);

/** The state after one event of the workspace stream; events Home does not read leave it as it was. */
export function reduceHome(state: HomeState, event: EventEnvelope): HomeState {
  switch (event.type) {
    case "notebooks.changed":
      return withList(state, event.data.notebooks);
    case "notebook.opened":
      return withOpen(state, event.notebook, true);
    case "notebook.closed":
      return withOpen(state, event.notebook, false);
    case "notebook.moved":
      return movedTo(state, event.data.path, event.data.to);
    case "kernel.status":
      // a closing notebook's last kernel event arrives after its close: it has no kernel to show
      if (!isOpen(state, event.notebook)) return state;
      return withKernel(
        state,
        event.notebook,
        nextKernel(state.kernels[event.notebook], event.data, event.ts),
      );
    default:
      return state;
  }
}
