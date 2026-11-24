// NotebookSummary of 03-api §4.2: what notebook.summary reads of a notebook without opening it, for Home's search and
// preview. Every field is derived from the cells' text and meta, never from running them.
import { z } from "zod";

import { CellType, LineRange } from "./cell.js";

/** A cell's last edit as the summary says it: who, through which client, when, and the lines an agent changed that no
 * one reviewed yet (none once reviewed, or for a person's edit). */
export const EditSummary = z
  .object({
    by: z.enum(["user", "agent", "external"]),
    client: z.enum(["ui", "cli", "mcp", "file"]),
    agent: z.string().optional(),
    at: z.string(),
    unreviewed: z.boolean(),
    lines: z.array(LineRange).readonly(),
  })
  .readonly();
export type EditSummary = z.infer<typeof EditSummary>;

/** One cell: its type, its name as the page says it, its first line with text, its size, a peek at its text and its
 * last edit. */
export const CellSummary = z
  .object({
    type: CellType,
    name: z.string(),
    line: z.string(),
    /** How many lines its source holds (0 for an empty cell). */
    lines: z.number().int().nonnegative(),
    /** A code cell's first four lines from its first line with text, as written; a markdown cell's first line of
     * text without its heading marks. Each line cut to 200 characters. */
    peek: z.array(z.string()).readonly(),
    lastEdit: EditSummary.nullable(),
  })
  .readonly();
export type CellSummary = z.infer<typeof CellSummary>;

/** The last result an open notebook's session holds (a notebook file holds no outputs, 07-file-format §3): the cell
 * whose run ended last with an output, when, and a few lines of it. */
export const LastResult = z
  .object({
    /** The 1-based number of the cell. */
    cell: z.number().int().positive(),
    /** When its run ended (ISO). */
    at: z.string(),
    /** `value`: the value's repr; `page`: what a client cell drew, as text; `html`: a display output; `text`: the last
     * lines it printed. */
    kind: z.enum(["value", "page", "html", "text"]),
    /** At most six lines, each cut to 200 characters. */
    lines: z.array(z.string()).readonly(),
  })
  .readonly();
export type LastResult = z.infer<typeof LastResult>;

export const NotebookSummary = z
  .object({
    path: z.string(),
    /** The first markdown cell's heading (its first line without the marks); "" with no markdown cell. */
    title: z.string(),
    /** The first paragraph after that line, its inline marks removed, cut to 280 characters. */
    text: z.string(),
    /** The same paragraph as written, its markdown kept for the page to render, cut to 600 characters. */
    intro: z.string(),
    /** The 1-based number of the cell the title and text come from; null with no markdown cell. */
    titleCell: z.number().int().positive().nullable(),
    cells: z.array(CellSummary).readonly(),
    /** The routes the code cells declare, `POST /webhook`, in notebook order. */
    routes: z.array(z.string()).readonly(),
    /** The names the server cells export, in notebook order. */
    exports: z.array(z.string()).readonly(),
    /** The packages the code cells import (bare specifiers, by package name; no Node built-in). */
    packages: z.array(z.string()).readonly(),
    /** The names the code cells read through env (`env.NAME`, `env["NAME"]`, `env.has("NAME")`), never a value. */
    secrets: z.array(z.string()).readonly(),
    /** The packages of `packages` the workspace cannot resolve now (node_modules of the folder or above, as a run's
     * pre-flight finds them): a run of a cell that imports one stops with MissingPackage. */
    missing: z.array(z.string()).readonly(),
    /** An open notebook's last result; null for a closed one (its file holds no outputs) or one that never ran. */
    lastResult: LastResult.nullable(),
  })
  .readonly();
export type NotebookSummary = z.infer<typeof NotebookSummary>;
