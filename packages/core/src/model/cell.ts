// Cell, CellMeta and EditInfo: a cell as the API returns it, with its per-cell preferences.
import { z } from "zod";

import { ExecStatus, ExecutionSummary } from "./execution.js";
import { CellId } from "./ids.js";

export const CellType = z.enum(["server", "client", "markdown"]);
export type CellType = z.infer<typeof CellType>;

/** Lines `from` to `to` of a cell's source, 1-based and both included. */
export const LineRange = z
  .object({ from: z.number().int().positive(), to: z.number().int().positive() })
  .readonly();
export type LineRange = z.infer<typeof LineRange>;

/** What the file keeps of agent edits no one reviewed yet: the code before the first of them. */
const storedReviewShape = { previousSource: z.string(), previousType: CellType };

/** Agent edits no one reviewed yet: the code before the first of them, and the lines of the source now that
 * differ from it (derived, never stored). */
export const EditReview = z
  .object({ ...storedReviewShape, lines: z.array(LineRange).readonly() })
  .readonly();
export type EditReview = z.infer<typeof EditReview>;

const editInfoShape = {
  by: z.enum(["user", "agent", "external"]),
  client: z.enum(["ui", "cli", "mcp", "file"]),
  agent: z.string().optional(),
  at: z.string(),
};

export const EditInfo = z.object({ ...editInfoShape, review: EditReview.optional() }).readonly();
export type EditInfo = z.infer<typeof EditInfo>;

/** EditInfo as the file stores it: the review without its lines, which follow from the two sources. */
export const FileEditInfo = z
  .object({ ...editInfoShape, review: z.object(storedReviewShape).readonly().optional() })
  .readonly();
export type FileEditInfo = z.infer<typeof FileEditInfo>;

export const OutputView = z.enum(["auto", "tree", "grid", "raw"]);
export type OutputView = z.infer<typeof OutputView>;

export const QueryMode = z.enum(["filter", "jsonpath", "jq", "sql"]);
export type QueryMode = z.infer<typeof QueryMode>;

/** The meta keys in the order the file writes them. */
export const cellMetaKeys = [
  "title",
  "showBindings",
  "collapsed",
  "headingCollapsed",
  "outputsHidden",
  "outputView",
  "outputQuery",
  "outputHeight",
  "outputColumns",
  "manual",
  "lastEdit",
] as const;

/** The keys a client may set through cell.update, each required here; `lastEdit` is the server's. */
export const editableMetaShape = {
  /** The name the user gave the cell (double click on its name, cell.update); the header shows it before any it derives. */
  title: z.string().max(200),
  showBindings: z.boolean(),
  collapsed: z.boolean(),
  /** A markdown cell's heading section is collapsed: the cells under its first heading, up to the next heading of the
   * same or a higher level, are hidden on the page (Jupyter's heading_collapsed). */
  headingCollapsed: z.boolean(),
  /** The outputs are hidden under a one-line note, the cell's source still shown (O, as Jupyter's outputs_hidden). */
  outputsHidden: z.boolean(),
  outputView: OutputView,
  /** A pinned query; `at`, Filter mode's node (default `$`), keeps a filter of a nested list pinned. */
  outputQuery: z
    .object({ mode: QueryMode, query: z.string(), at: z.string().optional() })
    .readonly(),
  outputHeight: z.enum(["capped", "fit"]),
  /** The grid's columns as the user arranged them: hidden ones, and an order of the rest. */
  outputColumns: z
    .object({
      hidden: z.array(z.string()).readonly().optional(),
      order: z.array(z.string()).readonly().optional(),
    })
    .readonly(),
  /** Never run by execution.autoRunDependents: it runs only when asked, and its dependents wait for it. */
  manual: z.boolean(),
};

/** The shape behind CellMeta (the API's); the file format builds its unknown-keys-kept variant on fileCellMetaShape. */
export const cellMetaShape = {
  title: editableMetaShape.title.optional(),
  showBindings: editableMetaShape.showBindings.optional(),
  collapsed: editableMetaShape.collapsed.optional(),
  headingCollapsed: editableMetaShape.headingCollapsed.optional(),
  outputsHidden: editableMetaShape.outputsHidden.optional(),
  outputView: editableMetaShape.outputView.optional(),
  outputQuery: editableMetaShape.outputQuery.optional(),
  outputHeight: editableMetaShape.outputHeight.optional(),
  outputColumns: editableMetaShape.outputColumns.optional(),
  manual: editableMetaShape.manual.optional(),
  lastEdit: EditInfo.optional(),
};

/** The meta keys as the file stores them: lastEdit's review without its derived lines. */
export const fileCellMetaShape = { ...cellMetaShape, lastEdit: FileEditInfo.optional() };

export const CellMeta = z.object(cellMetaShape).readonly();
export type CellMeta = z.infer<typeof CellMeta>;

export const Cell = z
  .object({
    id: CellId,
    type: CellType,
    source: z.string(),
    index: z.number().int().nonnegative(),
    meta: CellMeta,
    status: ExecStatus,
    stale: z.boolean(),
    /** Why a stale cell's result may be out of date: "edited since its last run", or the first name it uses that a cell
     * it depends on defines ("count changed in cell 2"); absent when the cell is not stale or nothing says why. */
    staleWhy: z.string().optional(),
    lastExecution: ExecutionSummary.nullable(),
  })
  .readonly();
export type Cell = z.infer<typeof Cell>;
