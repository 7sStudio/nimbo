// The notebook mirror: the page's copy of one notebook, a pure value the reducer derives from notebook.get
// and the event stream. No Vue here; store/notebook.ts holds it in a Pinia store.
import type {
  Cell,
  CellId,
  Diagnostic,
  EventOf,
  Execution,
  ExecStatus,
  NotebookState,
  Route,
} from "@jsnb/core";

/** "writing" while an edit waits for autosave; "failed" and "conflict" come from notebook.saveFailed and .conflict. */
type SaveState = "saved" | "writing" | "failed" | "conflict";

/** A cell's place in the dependency graph (notebook.graph). */
export type GraphEntry = {
  readonly defines: readonly string[];
  readonly uses: readonly string[];
  readonly exports: readonly string[];
  readonly dependsOn: readonly CellId[];
};

export type Mirror = {
  /** From notebook.get, then reduced; null before the first hydrate. */
  readonly notebook: NotebookState | null;
  /** The last execution per cell, keyed by cell id; outputs appended as they stream. */
  readonly executions: ReadonlyMap<CellId, Execution>;
  readonly graph: ReadonlyMap<CellId, GraphEntry>;
  readonly routes: readonly Route[];
  /** When the bridge last reported push-event activity (bridge.activity); null before any. */
  readonly bridgeActivity: string | null;
  /** The seq of the last applied event. */
  readonly seq: number;
  readonly saveState: SaveState;
  /** What notebook.saveFailed said, while saveState is "failed". */
  readonly saveError: { readonly code: string; readonly message: string } | null;
  /** Another client closed the notebook (notebook.closed): its kernel is gone and nothing runs until it opens again. */
  readonly closed: boolean;
  /** The language service's diagnostics per code cell (notebook.diagnostics, then cell.diagnostics); a cell
   * absent here has no list from the service yet. */
  readonly diagnostics: ReadonlyMap<CellId, readonly Diagnostic[]>;
  /** The last edit made to the file outside nimbo that the daemon merged, or found unreadable or in conflict
   * (notebook.reconciled), with its event's seq; null until one comes. */
  readonly external: (EventOf<"notebook.reconciled">["data"] & { readonly seq: number }) | null;
  /** The open conflict holds text recovered from a session that ended (notebook.get's `recovered`), until it ends. */
  readonly recovered: string | null;
  /** execution.autoRunDependents at work (cells.autoRun): the dependent running and those waiting, in order. */
  readonly autoRun: { readonly running: CellId | null; readonly pending: readonly CellId[] };
};

export const emptyMirror: Mirror = {
  notebook: null,
  executions: new Map(),
  graph: new Map(),
  routes: [],
  bridgeActivity: null,
  seq: 0,
  saveState: "saved",
  saveError: null,
  closed: false,
  diagnostics: new Map(),
  external: null,
  recovered: null,
  autoRun: { running: null, pending: [] },
};

/** The mirror after a (re)hydrate: the full state replaces the cells; executions, graph and routes of cells that still
 * exist are kept until their own refresh arrives. */
export function hydrated(mirror: Mirror, state: NotebookState, seq: number): Mirror {
  const ids = new Set(state.cells.map((cell) => cell.id));
  const keep = <V>(map: ReadonlyMap<CellId, V>) => new Map([...map].filter(([id]) => ids.has(id)));
  return {
    ...mirror,
    notebook: state,
    executions: keep(mirror.executions),
    graph: keep(mirror.graph),
    diagnostics: keep(mirror.diagnostics),
    seq,
    saveState: state.conflict ? "conflict" : state.dirty ? "writing" : "saved",
    recovered: state.recovered ?? null,
    saveError: null,
    closed: false,
    autoRun: state.autoRun ?? { running: null, pending: [] },
  };
}

/** The terminal statuses of a run. */
export const isTerminal = (status: ExecStatus): boolean =>
  status === "ok" || status === "error" || status === "interrupted";

/** The cells with one replaced by `next(cell)`. */
export const mapCell = (
  cells: readonly Cell[],
  id: CellId,
  next: (cell: Cell) => Cell,
): readonly Cell[] => cells.map((cell) => (cell.id === id ? next(cell) : cell));

/** Cells with `index` matching their position. */
export const reindexed = (cells: readonly Cell[]): readonly Cell[] =>
  cells.map((cell, index) => (cell.index === index ? cell : { ...cell, index }));
