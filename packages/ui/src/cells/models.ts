// The cells' view models: what a cell block's header, code, result and values show,
// as plain values a component renders and a component test builds by hand. cells/useCells.ts derives them from the
// stores; the pure helpers below are what it derives them with.
import type { Cell, CellMeta, CellType, ExecStatus, Execution, Route } from "@jsnb/core";

import type { SyntaxPlace } from "../editor/lint.js";
import { syntaxPlace } from "../editor/lint.js";

/** The last run, or the run going on: what the header's State and Time columns say in words. */
export type RunFact =
  | { readonly kind: "none" }
  /** `at`: when the run started (ISO), for "ran at 14:01". */
  | { readonly kind: "ok"; readonly ms: number | null; readonly at: string | null }
  /** `line`: the line of the cell that threw, when the error's first frame names one. */
  | {
      readonly kind: "error";
      readonly name: string;
      readonly ms: number | null;
      readonly line: number | null;
      /** A server cell's DefinedInClient: ↩ switches it to client; gone once it is client. */
      readonly switchable?: true;
    }
  | { readonly kind: "syntax"; readonly place: SyntaxPlace }
  /** `unstarted`: an interrupt took it off the queue before it ran (no output, no time). */
  | { readonly kind: "interrupted"; readonly ms: number | null; readonly unstarted: boolean }
  /** Run all stopped before it ran, because the run of the cell numbered `stoppedAt` failed (null: that cell is gone). */
  | { readonly kind: "notRun"; readonly stoppedAt: number | null }
  | { readonly kind: "queued"; readonly after: number | null }
  | { readonly kind: "running"; readonly elapsed: string }
  /** Not run in this kernel: the outputs shown were saved in the file by an earlier session (`at`: when it ran). */
  | { readonly kind: "saved"; readonly at: string };

export type CellModel = {
  readonly id: string;
  /** 1-based place in the notebook ("Cell 3"). */
  readonly number: number;
  readonly type: CellType;
  readonly source: string;
  readonly status: ExecStatus;
  readonly stale: boolean;
  /** The execution count, Jupyter's `[n]` (store/runCounts.ts); null before the cell ran in this kernel. */
  readonly count: number | null;
  readonly selected: boolean;
  /** The selected cell itself, which holds the tab stop; the other cells of a marked range are selected only. */
  readonly current: boolean;
  readonly editing: boolean;
  /** Runs are off for this cell: the page cannot write, or a client cell has no page to run in. */
  readonly runOff: boolean;
  /** What the cell is for, and a few words about it (cells/names.ts). */
  readonly name: string;
  readonly about: string;
  /** Why its result may be out of date ("edited since its last run", "balance changed in cell 2"), "" when it is stale
   * with nothing to say, null when it is not stale. */
  readonly staleWhy: string | null;
  /** Its text changed after its last run started (its last edit is the later of the two). */
  readonly editedSince: boolean;
  /** Routes it registered that are listening, and the requests they answered. */
  readonly routes: { readonly count: number; readonly hits: number };
  readonly run: RunFact;
  readonly meta: CellMeta;
  /** It shows its header row alone: folded by its own meta.collapsed (W, its arrow) or by Fold All (store/fold.ts). */
  readonly folded: boolean;
  /** What the name column adds while it is folded: what is inside (cells/summary.ts). */
  readonly inside: string;
  /** Its result is pinned to the inspector (P). */
  readonly pinned: boolean;
  /** Its header shows the title field (double click on the name, F2). */
  readonly renaming: boolean;
  /** execution.autoRunDependents: waiting to run, running, or its last run was started by it after a run of cell
   * `after` (0 when that cell is gone, or while waiting or running); null otherwise. */
  readonly autoRun: {
    readonly state: "pending" | "running" | "ran";
    readonly after: number;
  } | null;
};

/** The cell's part in an auto-run cascade, from the cascade's state and the cell's last run. */
export function autoRunOf(
  cell: string,
  cascade: { readonly running: string | null; readonly pending: readonly string[] },
  last: Execution | undefined,
  numberOf: (cell: string) => number,
): CellModel["autoRun"] {
  if (cascade.running === cell) return { state: "running", after: 0 };
  if (cascade.pending.includes(cell)) return { state: "pending", after: 0 };
  return last?.autoRun === undefined ? null : { state: "ran", after: numberOf(last.autoRun.cell) };
}

/** "Cell 3, server, ok": the list item's label. */
export function cellLabel(cell: Pick<CellModel, "number" | "type" | "status" | "stale">): string {
  const busy = cell.status === "running" || cell.status === "queued" || cell.status === "error";
  const state = cell.stale && !busy ? "stale" : cell.status;
  return `Cell ${String(cell.number)}, ${cell.type}, ${state}`;
}

/** Whether the cell's last edit came after its last run started: its result is of older text. */
export function editedSince(cell: Pick<Cell, "meta" | "lastExecution">): boolean {
  const edited = Date.parse(cell.meta.lastEdit?.at ?? "");
  const ran = Date.parse(cell.lastExecution?.startedAt ?? "");
  return !Number.isNaN(edited) && !Number.isNaN(ran) && edited > ran;
}

/** The routes `cell` registered that are listening, and the requests they answered. */
export function routesOf(
  cell: string,
  routes: readonly Route[],
): { readonly count: number; readonly hits: number } {
  const mine = routes.filter((route) => route.cell === cell);
  return { count: mine.length, hits: mine.reduce((sum, route) => sum + route.hits, 0) };
}

/** What the run facts need beyond the cell: the running time, the cell a queued run waits for, and the number of a
 * cell by its id (0 when it is gone). */
export type RunContext = {
  readonly elapsed: string | null;
  readonly after: number | null;
  readonly numberOf?: (cell: string) => number;
};

/** An interrupted run: one that never started (Run all stopped by a failure, or an interrupt that cleared the queue)
 * says so and has no time; one the interrupt stopped while it ran keeps its time. */
function interruptedFact(
  execution: Execution | undefined,
  ms: number | null,
  context: RunContext,
): RunFact {
  if (execution?.stoppedBy !== undefined) {
    const at = context.numberOf?.(execution.stoppedBy) ?? 0;
    return { kind: "notRun", stoppedAt: at > 0 ? at : null };
  }
  const unstarted = ms === 0 && execution?.outputs.length === 0;
  return { kind: "interrupted", ms, unstarted };
}

/** The last run's fact from the cell's status and its execution (the summary's duration, the fetched error). */
export function runFact(
  cell: Pick<Cell, "status" | "lastExecution" | "type">,
  execution: Execution | undefined,
  context: RunContext,
): RunFact {
  const ms = execution?.durationMs ?? cell.lastExecution?.durationMs ?? null;
  const facts: Readonly<Record<ExecStatus, () => RunFact>> = {
    idle: () => ({ kind: "none" }),
    running: () => ({ kind: "running", elapsed: context.elapsed ?? "0.0 s" }),
    queued: () => ({ kind: "queued", after: context.after }),
    ok: () => ({
      kind: "ok",
      ms,
      at: execution?.startedAt ?? cell.lastExecution?.startedAt ?? null,
    }),
    interrupted: () => interruptedFact(execution, ms, context),
    error: () => errorFact(execution, ms, cell.type),
  };
  if (cell.status === "idle" && execution?.restored === true)
    return { kind: "saved", at: execution.startedAt };
  return facts[cell.status]();
}

/** The line of this cell the error came through: its first frame that is this cell's. A throw inside a function
 * another cell defines names the line here that called it; the result under the code shows the whole stack. */
function thrownAt(execution: Execution | undefined): number | null {
  return execution?.error?.frames.find((frame) => frame.cell === execution.cell)?.line ?? null;
}

function errorFact(execution: Execution | undefined, ms: number | null, type: CellType): RunFact {
  const place = syntaxPlace(execution?.error);
  if (place !== null) return { kind: "syntax", place };
  const name = execution?.error?.name ?? "Error";
  const switchable = type === "server" && name === "DefinedInClient";
  return {
    kind: "error",
    name,
    ms,
    line: thrownAt(execution),
    ...(switchable ? { switchable: true } : {}),
  };
}

/** The number of lines of `source` ("14 lines"). */
export const lineCount = (source: string): number => source.split("\n").length;
