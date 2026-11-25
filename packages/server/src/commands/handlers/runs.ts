// The run commands of 03-api §4.3 and §4.2: cell.run (its `source` applied first, stamped like an update), the last
// run's outputs, a value's slices and queries, the bindings of a cell, and notebook.run over a selection.
import type { CellId, Execution } from "@jsnb/core";
import {
  InvalidParams,
  cellBindings,
  cellCompare,
  cellOutputQuery,
  cellOutputs,
  cellOutputValue,
  cellRun,
  notebookClearOutputs,
  notebookRun,
} from "@jsnb/core";

import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Services } from "../services.js";

type ValueAt = {
  readonly cell: CellId;
  readonly execution?: string | undefined;
  readonly index?: number | undefined;
};

const indexIssue = (message: string): InvalidParams =>
  new InvalidParams({ issues: [{ path: ["index"], message }] });

/**
 * The value output a slice or a query reads when `index` is left out: the last value output of the cell's last run
 * (an agent seldom knows the index); a run other than the last needs its index.
 */
function valueIndex(last: Execution | null, at: ValueAt): number {
  if (at.index !== undefined) return at.index;
  if (last === null) throw indexIssue(`${at.cell} has not run yet.`);
  if (at.execution !== undefined && at.execution !== last.id)
    throw indexIssue(
      `give the index of the value output in ${at.execution}, which is not the last run.`,
    );
  const index = last.outputs.findLastIndex((output) => output.kind === "value");
  if (index < 0) throw indexIssue(`the last run of ${at.cell} has no value output.`);
  return index;
}

export function runHandlers({ workspace }: Services): readonly Bound[] {
  const session = (notebook: string) => workspace.notebooks.require(notebook);
  return [
    bind(cellRun, async ({ notebook, cell, source, base, ...waiting }, { declaration }) => {
      const open = await session(notebook);
      if (source !== undefined) open.update({ cell, source, base }, declaration);
      return open.runWithDependents(cell, { ...waiting, by: declaration });
    }),
    bind(cellOutputs, async ({ notebook, cell }) => ({
      execution: (await session(notebook)).outputs(cell),
    })),
    bind(cellCompare, async ({ notebook, cell, limit }) =>
      (await session(notebook)).compare(cell, limit),
    ),
    bind(cellOutputValue, async ({ notebook, ...request }) => {
      const open = await session(notebook);
      const index = valueIndex(open.outputs(request.cell), request);
      return open.outputValue({ ...request, index });
    }),
    bind(cellBindings, async ({ notebook, cell }) => ({
      bindings: await (await session(notebook)).bindings(cell),
    })),
    bind(notebookRun, async ({ notebook, ...input }, { declaration }) =>
      (await session(notebook)).runAll({ ...input, by: declaration }),
    ),
    bind(notebookClearOutputs, async ({ notebook, cells }) => ({
      cleared: (await session(notebook)).clearOutputs(cells),
    })),
    bind(cellOutputQuery, async ({ notebook, ...request }) => {
      const open = await session(notebook);
      const index = valueIndex(open.outputs(request.cell), request);
      return open.outputQuery({ ...request, index });
    }),
  ];
}
