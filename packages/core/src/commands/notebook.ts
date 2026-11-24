// The notebook commands of 03-api §4.2.
import { z } from "zod";

import { CellId, ExecutionId, NotebookRef } from "../model/ids.js";
import { Execution } from "../model/execution.js";
import { NotebookState } from "../model/notebook.js";
import { ErrorInfo } from "../model/output.js";
import { Selection } from "../model/selection.js";
import { NotebookSummary } from "../model/summary.js";
import { defineCommand } from "./define.js";

const state = z.object({ notebook: NotebookState });

export const notebookCreate = defineCommand({
  name: "notebook.create",
  description: "Create an empty .jsnb file and open it. Fails if the file exists.",
  input: z.object({ path: NotebookRef }),
  output: state,
  tags: { mutating: true },
});

export const notebookOpen = defineCommand({
  name: "notebook.open",
  description: "Load the file and start its kernel. Opening an open notebook changes nothing.",
  input: z.object({ path: NotebookRef }),
  output: state,
  tags: { mutating: true, idempotent: true },
});

export const notebookGet = defineCommand({
  name: "notebook.get",
  description: "The full state of an open notebook, including each cell's last execution.",
  input: z.object({ notebook: NotebookRef }),
  output: state,
});

export const notebookSave = defineCommand({
  name: "notebook.save",
  description:
    "Force a write now. With force, overwrite a file that changed on disk; without it a conflict is an error.",
  input: z.object({ notebook: NotebookRef, force: z.boolean().default(false) }),
  output: z.object({ savedAt: z.string() }),
  tags: { mutating: true },
});

export const notebookReload = defineCommand({
  name: "notebook.reload",
  description:
    "Re-read the file and reconcile by cell id: same ids keep their outputs, new cells start idle, removed cells disappear.",
  input: z.object({ notebook: NotebookRef }),
  output: state,
  tags: { mutating: true },
});

export const notebookClose = defineCommand({
  name: "notebook.close",
  description: "Stop the kernel and detach the realm.",
  input: z.object({ notebook: NotebookRef }),
  output: z.object({}),
  tags: { destructive: true },
});

export const notebookDelete = defineCommand({
  name: "notebook.delete",
  description:
    "Delete the file of a notebook that is not open (close it first). Nothing else in its folder is touched.",
  input: z.object({ path: NotebookRef }),
  output: z.object({}),
  tags: { destructive: true },
});

export const notebookRename = defineCommand({
  name: "notebook.rename",
  description:
    "Move a notebook's file to a new path in the workspace, creating its folders. An open notebook stays open under the new path, its kernel running on (its followers get notebook.moved). Fails if the new path exists.",
  input: z.object({ path: NotebookRef, to: NotebookRef }),
  output: z.object({}),
  tags: { mutating: true },
});

export const notebookSummary = defineCommand({
  name: "notebook.summary",
  description:
    "What a notebook holds, read from its cells without opening it or running anything: the title and text of its first markdown cell, one line per cell with its name and last edit, and the routes, exports, packages and env names its code declares.",
  input: z.object({ path: NotebookRef }),
  output: z.object({ summary: NotebookSummary }),
});

export const notebookRun = defineCommand({
  name: "notebook.run",
  description:
    "Run the selected cells in notebook order, one at a time. Client cells with no page attached are skipped.",
  input: z.object({
    notebook: NotebookRef,
    select: Selection,
    wait: z.boolean().default(true),
    timeoutMs: z.number().int().positive().default(30_000),
    stopOnError: z.boolean().default(true),
  }),
  output: z.object({
    executions: z.array(Execution),
    skipped: z.array(z.object({ cell: CellId, code: z.literal("REALM_NOT_ATTACHED") })),
  }),
  tags: { mutating: true },
});

export const notebookClearOutputs = defineCommand({
  name: "notebook.clearOutputs",
  description:
    "Clear the outputs and execution counts of the given cells, or of every cell, as Jupyter's Clear All Outputs; the kernel's state stays. A cell running or queued keeps its run.",
  input: z.object({
    notebook: NotebookRef,
    cells: z.array(CellId).optional(),
  }),
  output: z.object({ cleared: z.array(CellId) }),
  tags: { mutating: true, idempotent: true },
});

export const notebookErrors = defineCommand({
  name: "notebook.errors",
  description: "The cells whose last run failed, with their errors.",
  input: z.object({ notebook: NotebookRef }),
  output: z.object({
    errors: z.array(z.object({ cell: CellId, execution: ExecutionId, error: ErrorInfo })),
  }),
});

export const notebookGraph = defineCommand({
  name: "notebook.graph",
  description:
    "The dependency graph from static analysis: what each cell defines, uses and exports.",
  input: z.object({ notebook: NotebookRef }),
  output: z.object({
    cells: z.array(
      z.object({
        id: CellId,
        defines: z.array(z.string()),
        uses: z.array(z.string()),
        exports: z.array(z.string()),
        dependsOn: z.array(CellId),
        stale: z.boolean(),
      }),
    ),
  }),
});

export const notebookExport = defineCommand({
  name: "notebook.export",
  description:
    "The notebook as one self-contained HTML page: markdown rendered, code, and each cell's last outputs, redacted; no script runs in it. With path, also written there (inside the workspace).",
  input: z.object({
    notebook: NotebookRef,
    format: z.literal("html").default("html"),
    outputs: z.boolean().default(true),
    theme: z.enum(["light", "dark"]).optional(),
    path: z.string().optional(),
  }),
  output: z.object({ html: z.string(), path: z.string().optional() }),
});
