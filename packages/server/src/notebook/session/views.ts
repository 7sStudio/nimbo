// What a session answers about itself: the NotebookState of notebook.get, the dependency graph of
// notebook.graph (uses restricted to names other cells provide) and the failed last runs of notebook.errors.
import type {
  CellId,
  DebugState,
  ErrorInfo,
  ExecutionId,
  NotebookState,
  RealmStatus,
} from "@jsnb/core";

import type { SessionContext } from "./context.js";

export type GraphView = {
  readonly cells: {
    readonly id: CellId;
    readonly defines: string[];
    readonly uses: string[];
    readonly exports: string[];
    readonly dependsOn: CellId[];
    readonly stale: boolean;
  }[];
};

export type ErrorsView = {
  readonly errors: {
    readonly cell: CellId;
    readonly execution: ExecutionId;
    readonly error: ErrorInfo;
  }[];
};

/** notebook.get's state; `realm` comes from the session's realm part. */
export function stateOf(
  context: SessionContext,
  realm: RealmStatus,
  debug: DebugState,
): NotebookState {
  const { savedAt, dirty, conflict, conflictCells } = context.autosave.state();
  return {
    path: context.ref,
    cells: context.cells.list().map(context.cells.api),
    kernel: context.kernel.status(),
    realm,
    savedAt,
    dirty,
    ...(conflict ? { conflict: { cells: [...conflictCells] } } : {}),
    ...(context.recovered === undefined ? {} : { recovered: context.recovered }),
    debug,
    autoRun: context.hooks.autoRunState(),
  };
}

export function graphOf(context: SessionContext): GraphView {
  const stale = context.cells.stale();
  return {
    cells: context.cells.graph().cells.map((cell) => ({
      id: cell.id,
      defines: [...cell.defines],
      uses: [...cell.uses],
      exports: [...cell.exports],
      dependsOn: [...cell.dependsOn],
      stale: stale[cell.id] === true,
    })),
  };
}

const unknownError: ErrorInfo = { name: "Error", message: "The run failed.", frames: [], raw: "" };

export function errorsOf(context: SessionContext): ErrorsView {
  return {
    errors: context.cells.list().flatMap((record) =>
      record.last?.status === "error"
        ? [
            {
              cell: record.id,
              execution: record.last.id,
              error: record.last.error ?? unknownError,
            },
          ]
        : [],
    ),
  };
}
