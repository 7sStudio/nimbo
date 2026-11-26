// One cell's breakpoints sent to js-debug (DAP setBreakpoints by the cell's source path) and its answer taken in: each
// breakpoint's id within that source, whether it is bound, and the line js-debug bound it on. A list js-debug already
// holds is not sent again: it answers a repeat with no entries and numbers its breakpoints anew.
import type { CellId } from "@jsnb/core";

import type { DapConnection } from "../../kernel/debug/dap.js";
import { dap } from "../../kernel/debug/protocol.js";
import type { BreakpointRecord, Breakpoints } from "./breakpoints.js";
import type { Dialect } from "./conditions.js";
import { translated } from "./conditions.js";

export type CellBreakpoints = {
  readonly path: string;
  readonly cell: CellId;
  /** The cell runs in this js-debug's realm: its breakpoints are this session's to bind. */
  readonly owns: boolean;
  /** What js-debug should hold for the cell: none for a cell of the other realm. */
  readonly breakpoints: readonly BreakpointRecord[];
  readonly dialect: Dialect;
};

/** What setBreakpoints sends for `each`; a condition that does not parse leaves its message on the breakpoint. */
function optionsOf(each: BreakpointRecord, dialect: Dialect) {
  const { condition, message } = translated(each, dialect);
  if (message !== undefined) each.message = message;
  return {
    line: each.line,
    ...(condition === undefined ? {} : { condition }),
    ...(each.hitCondition === undefined ? {} : { hitCondition: each.hitCondition }),
  };
}

/** Empties js-debug's lists under `paths`, which no cell has any more (the notebook's file moved). */
export function forgetSources(
  child: DapConnection,
  held: Map<string, string>,
  paths: readonly string[],
): void {
  for (const path of paths) {
    held.delete(path);
    void dap.setBreakpoints(child, { source: { path }, breakpoints: [] }).catch(() => undefined);
  }
}

type Bound = {
  readonly id?: number | undefined;
  readonly verified: boolean;
  readonly line?: number | undefined;
};

/** js-debug's answer taken in, entry by entry; true when a breakpoint moved onto another's line and went. */
function taken(
  store: Breakpoints,
  sent: readonly BreakpointRecord[],
  answer: readonly Bound[],
): boolean {
  let merged = false;
  for (const [index, bound] of answer.entries()) {
    const each = sent[index];
    if (!each) continue;
    each.verified = bound.verified;
    if (bound.id === undefined) delete each.dapId;
    else each.dapId = bound.id;
    if (bound.verified && bound.line !== undefined)
      merged = store.bound(each, bound.line) || merged;
  }
  return merged;
}

export async function sendBreakpoints(
  child: DapConnection,
  store: Breakpoints,
  sent: CellBreakpoints,
  held: Map<string, string>,
): Promise<void> {
  const breakpoints = sent.breakpoints.map((each) => optionsOf(each, sent.dialect));
  const signature = JSON.stringify(breakpoints);
  if (held.get(sent.path) === signature) return;
  const answer = await dap.setBreakpoints(child, { source: { path: sent.path }, breakpoints });
  held.set(sent.path, signature);
  if (!sent.owns) return;
  for (const each of store.ofCell(sent.cell)) {
    if (sent.breakpoints.includes(each)) continue;
    each.verified = false;
    delete each.dapId;
  }
  if (taken(store, sent.breakpoints, answer.breakpoints))
    await sendBreakpoints(child, store, { ...sent, breakpoints: store.ofCell(sent.cell) }, held);
}
