// The language service's commands: every code cell's diagnostics, the bridge's exports with
// their signatures and rename for any caller, and the page's LSP tunnel over its WebSocket.
import { z } from "zod";

import { CellId, NotebookRef } from "../model/ids.js";
import { BridgeExport, CellDiagnostics, CellPosition } from "../model/language.js";
import { defineCommand } from "./define.js";

export const notebookDiagnostics = defineCommand({
  name: "notebook.diagnostics",
  description: "Type errors and unknown names in the notebook's code cells, or in one cell.",
  input: z.object({ notebook: NotebookRef, cell: CellId.optional() }),
  output: z.object({ cells: z.array(CellDiagnostics).readonly() }),
});

export const notebookBridge = defineCommand({
  name: "notebook.bridge",
  description:
    "The functions server cells export for client cells to call: each with its cell, its TypeScript signature and documentation, and the client cells that use it.",
  input: z.object({ notebook: NotebookRef }),
  output: z.object({ exports: z.array(BridgeExport).readonly() }),
});

export const languageLsp = defineCommand({
  name: "language.lsp",
  description:
    "Called by the page over its WebSocket: one LSP JSON-RPC message; the reply answers a request, null a notification.",
  input: z.object({ notebook: NotebookRef, message: z.string() }),
  output: z.object({ reply: z.string().nullable() }),
  tags: { internal: true },
});

export const languageRename = defineCommand({
  name: "language.rename",
  description:
    "Rename a name across the notebook's cells and the bridge, as F2 does in the editor; answers the cells it changed. Name it with `name` (the cell that declares it is found when `cell` is left out) or with `cell` and a 0-based `position` on it. Refused (RenameRefused) for a package's or a built-in's name.",
  input: z.object({
    notebook: NotebookRef,
    cell: CellId.optional(),
    position: CellPosition.optional(),
    name: z.string().min(1).optional(),
    newName: z.string().min(1),
  }),
  output: z.object({ cells: z.array(CellId).readonly() }),
  tags: { mutating: true },
});
