// The cell commands of 03-api §4.3.
// Over 150 lines because the thirteen cell commands of the table live together, one descriptor each.
import { z } from "zod";

import { BindingValue } from "../model/binding.js";
import { Cell, CellType, editableMetaShape, QueryMode } from "../model/cell.js";
import { Chip } from "../model/chip.js";
import { Execution } from "../model/execution.js";
import { CellId, ExecutionId, NotebookRef } from "../model/ids.js";
import { defineCommand } from "./define.js";
import { RunComparisonSchema } from "../model/runComparison.js";

const ref = { notebook: NotebookRef, cell: CellId };

export const cellAdd = defineCommand({
  name: "cell.add",
  description:
    "Add a cell after another (or at the end); with run, run it and wait. An explicit id must be unused.",
  input: z.object({
    notebook: NotebookRef,
    type: CellType,
    source: z.string().default(""),
    after: z.union([CellId, z.null()]).optional(),
    run: z.boolean().default(false),
    id: CellId.optional(),
  }),
  output: z.object({ cell: Cell, execution: Execution.optional() }),
  tags: { mutating: true },
});

export const cellGet = defineCommand({
  name: "cell.get",
  description: "One cell by id, with its status and last execution summary.",
  input: z.object(ref),
  output: z.object({ cell: Cell }),
});

/** `meta.lastEdit` is server-owned: a client that sends it gets INVALID_PARAMS. Every other key may be `null`, which
 * removes it (an unpinned query, a view back to auto): JSON has no undefined to send. */
const editableMeta = z.strictObject({
  title: editableMetaShape.title.nullable().optional(),
  showBindings: editableMetaShape.showBindings.nullable().optional(),
  collapsed: editableMetaShape.collapsed.nullable().optional(),
  headingCollapsed: editableMetaShape.headingCollapsed.nullable().optional(),
  outputsHidden: editableMetaShape.outputsHidden.nullable().optional(),
  outputView: editableMetaShape.outputView.nullable().optional(),
  outputQuery: editableMetaShape.outputQuery.nullable().optional(),
  outputHeight: editableMetaShape.outputHeight.nullable().optional(),
  outputColumns: editableMetaShape.outputColumns.nullable().optional(),
});

export const cellUpdate = defineCommand({
  name: "cell.update",
  description:
    "Change the source, the type or the meta (merged; a null key removes it; meta.title names the cell). Dependents become stale when the source changes.",
  input: z.object({
    ...ref,
    source: z.string().optional(),
    type: CellType.optional(),
    meta: editableMeta.optional(),
  }),
  output: z.object({ cell: Cell }),
  tags: { mutating: true, idempotent: true },
});

export const cellRevert = defineCommand({
  name: "cell.revert",
  description:
    "Put back the code an agent's edits replaced (the source and type before the first edit no one reviewed), as an edit of its own; a cell with no such edit is left as it is.",
  input: z.object(ref),
  output: z.object({ cell: Cell }),
  tags: { mutating: true, idempotent: true },
});

export const cellMarkReviewed = defineCommand({
  name: "cell.markReviewed",
  description:
    "Mark the agent edits of a cell no one reviewed yet as reviewed: the code stays, meta.lastEdit loses its review.",
  input: z.object(ref),
  output: z.object({ cell: Cell }),
  tags: { mutating: true, idempotent: true },
});

export const cellMove = defineCommand({
  name: "cell.move",
  description: "Move a cell after another, or to the top with after null.",
  input: z.object({ ...ref, after: z.union([CellId, z.null()]) }),
  output: z.object({ order: z.array(CellId) }),
  tags: { mutating: true, idempotent: true },
});

export const cellDelete = defineCommand({
  name: "cell.delete",
  description:
    "Delete a cell. Its scope bindings stay in the kernel until restart; dependents become stale.",
  input: z.object(ref),
  output: z.object({}),
  tags: { destructive: true },
});

export const cellRun = defineCommand({
  name: "cell.run",
  description:
    "Run one cell. With wait, returns when the run reaches a terminal status, timeoutMs elapses, or the kernel pauses in the debugger (then `paused` says where; go on with debug.resume).",
  input: z.object({
    ...ref,
    source: z.string().optional(),
    wait: z.boolean().default(true),
    timeoutMs: z.number().int().positive().default(30_000),
  }),
  output: z.object({ execution: Execution }),
  tags: { mutating: true },
});

export const cellOutputs = defineCommand({
  name: "cell.outputs",
  description: "The last run of a cell with all its outputs, or null if it never ran.",
  input: z.object(ref),
  output: z.object({ execution: Execution.nullable() }),
});

export const cellCompare = defineCommand({
  name: "cell.compare",
  description:
    "Compare a cell's last run with the run before it (a saved run counts): status, the last value's changed paths, the printed lines added and removed, the error. Null when the cell has not run twice.",
  input: z.object({ ...ref, limit: z.number().int().positive().default(200) }),
  output: z.object({
    comparison: RunComparisonSchema.nullable(),
    previous: Execution.nullable(),
    current: Execution.nullable(),
  }),
});

export const cellOutputValue = defineCommand({
  name: "cell.outputValue",
  description:
    "A slice of one value output (the last run's last value output unless execution or index says another): the children of path from offset, at most limit entries, each capped.",
  input: z.object({
    ...ref,
    execution: ExecutionId.optional(),
    index: z.number().int().nonnegative().optional(),
    path: z.string().default("$"),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().positive().default(2000),
  }),
  output: z.object({
    json: z.unknown(),
    total: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
});

export const cellBindings = defineCommand({
  name: "cell.bindings",
  description:
    "Every name the cell's last run defined, with its current value and the cell that defined it.",
  input: z.object(ref),
  output: z.object({ bindings: z.array(BindingValue) }),
});

export const cellOutputQuery = defineCommand({
  name: "cell.outputQuery",
  description:
    "Run a filter, JSONPath, jq or SQL query against one value output on the daemon: the last run's last value output unless execution or index says another. SQL reads the value as table t (an array's items as rows; a list of plain values is one column, value).",
  input: z.object({
    ...ref,
    execution: ExecutionId.optional(),
    index: z.number().int().nonnegative().optional(),
    mode: QueryMode,
    query: z.union([z.string(), z.array(Chip)]),
    /** Filter mode: the JSONPath of the node whose children the chips filter; default `$`. */
    at: z.string().optional(),
    limit: z.number().int().positive().default(2000),
  }),
  output: z.object({
    mode: QueryMode,
    result: z.object({
      paths: z.array(z.string()).optional(),
      value: z.unknown().optional(),
      columns: z.array(z.object({ name: z.string(), type: z.string() })).optional(),
      rows: z.array(z.unknown()).optional(),
    }),
    total: z.number().int().nonnegative(),
    truncated: z.boolean(),
    durationMs: z.number().nonnegative(),
    /** The query ran past query.timeoutMs and was stopped: a result, not an error (08 §5); `result` is empty. */
    timedOut: z.boolean().optional(),
  }),
});

export const cellSnapshot = defineCommand({
  name: "cell.snapshot",
  description:
    "Read a client cell's rendered container from the attached page: its accessible text in reading order, and with html its HTML without scripts, styles or event handlers (form values as attributes), each cut to maxBytes. Needs a page holding the client realm (REALM_NOT_ATTACHED otherwise). image is not available yet.",
  input: z.object({
    ...ref,
    /** Also answer the container's sanitised HTML. */
    html: z.boolean().optional(),
    maxBytes: z.number().int().positive().default(65_536),
    /** An image of the container: needs a headless browser realm, not available yet (NOT_AVAILABLE). */
    image: z.boolean().optional(),
  }),
  output: z.object({
    text: z.string(),
    html: z.string().optional(),
    /** False when the cell has no container in the page: not run there, or it never used `display` or `document`. */
    rendered: z.boolean(),
    truncated: z.boolean(),
  }),
});
