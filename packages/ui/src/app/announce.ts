// The run results the page announces to a screen reader: "Cell 3 finished in 412 ms", "Cell 4
// failed: TypeError", "Cell 2 was interrupted", "Cell 5 was not run" (Run all stopped at an earlier failure), for each
// execution that reached its end since the last look.
import type { CellId, Execution } from "@jsnb/core";

import { isTerminal } from "../store/mirror.js";

/** The announcement for a finished `execution` of the cell at `position` (1-based); null while it runs, and null
 * while the mirror holds only the event's end of it: the duration and the error arrive with the fetched execution
 * (store/sync.ts), and the line says them. An interrupted run needs neither. */
export function announcement(execution: Execution, position: number): string | null {
  if (!isTerminal(execution.status)) return null;
  const cell = `Cell ${String(position)}`;
  // a run that Run all never started (an earlier cell failed) was not run, not interrupted (stoppedBy)
  if (execution.status === "interrupted")
    return execution.stoppedBy === undefined ? `${cell} was interrupted` : `${cell} was not run`;
  if (execution.status === "error")
    return execution.error === undefined ? null : `${cell} failed: ${execution.error.name}`;
  return execution.durationMs === undefined
    ? null
    : `${cell} finished in ${String(Math.round(execution.durationMs))} ms`;
}

/** The announcements for executions started at `since` or later and not in `seen` (ids already announced), in cell
 * order: a run that ended before the page loaded is not news. */
export function newAnnouncements(
  executions: ReadonlyMap<CellId, Execution>,
  order: readonly CellId[],
  seen: { readonly ids: ReadonlySet<string>; readonly since: number },
): readonly { readonly id: string; readonly text: string }[] {
  return order.flatMap((cell, index) => {
    const execution = executions.get(cell);
    if (execution === undefined || seen.ids.has(execution.id)) return [];
    if (Date.parse(execution.startedAt) < seen.since) return [];
    const text = announcement(execution, index + 1);
    return text === null ? [] : [{ id: execution.id, text }];
  });
}
