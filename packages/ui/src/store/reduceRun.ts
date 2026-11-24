// The run half of the reducer: cell.status and cell.output (03-api §6) on the mirror's cells and executions.
import type { EventEnvelope, EventOf, Execution } from "@jsnb/core";

import type { Mirror } from "./mirror.js";
import { mapCell } from "./mirror.js";

/** The execution a status event belongs to: the known one, or a new one started at the event's time. */
function runOf(mirror: Mirror, event: EventOf<"cell.status">): Execution {
  const { cell, execution, status, count } = event.data;
  const counted = count === undefined ? {} : { count };
  const known = mirror.executions.get(cell);
  if (known?.id === execution) return { ...known, status, ...counted };
  return { id: execution, cell, status, startedAt: event.ts, outputs: [], ...counted };
}

function status(mirror: Mirror, event: EventOf<"cell.status">): Mirror {
  const run = runOf(mirror, event);
  const executions = new Map(mirror.executions).set(run.cell, run);
  if (mirror.notebook === null) return { ...mirror, executions };
  const cells = mapCell(mirror.notebook.cells, run.cell, (cell) => ({
    ...cell,
    status: run.status,
    // the summary follows the run it names, so its count is there before the cell's next fetch
    lastExecution:
      cell.lastExecution?.id === run.id && run.count !== undefined
        ? { ...cell.lastExecution, count: run.count }
        : cell.lastExecution,
  }));
  return { ...mirror, executions, notebook: { ...mirror.notebook, cells } };
}

function output(mirror: Mirror, event: EventOf<"cell.output">): Mirror {
  const { cell, execution, output: out } = event.data;
  const known = mirror.executions.get(cell);
  // An output of a run the mirror does not follow (an older one, or one before a resync) is dropped; the store's
  // cell.outputs fetch after the run ends brings the authoritative list.
  if (known?.id !== execution) return mirror;
  const run = { ...known, outputs: [...known.outputs, out] };
  return { ...mirror, executions: new Map(mirror.executions).set(cell, run) };
}

/** cell.status and cell.output; any other event leaves the mirror as it is. */
export function reduceRun(mirror: Mirror, event: EventEnvelope): Mirror {
  if (event.type === "cell.status") return status(mirror, event);
  if (event.type === "cell.output") return output(mirror, event);
  return mirror;
}
