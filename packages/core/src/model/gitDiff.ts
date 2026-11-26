// The shapes of the Source Control view: a file's change as git status lists it, the repository's
// status, and a diff, either of two texts (hunks of lines) or of two notebooks (rows of cells matched across both).
import { z } from "zod";

import { CellType } from "./cell.js";
import { ExecStatus } from "./execution.js";
import { RunComparisonSchema } from "./runComparison.js";

/** One line of a diff, as `lineDiff` gives it: kept (its number on both sides), removed or added. */
export const DiffLineSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("same"), text: z.string(), before: z.number(), after: z.number() })
    .readonly(),
  z.object({ kind: z.literal("removed"), text: z.string(), before: z.number() }).readonly(),
  z.object({ kind: z.literal("added"), text: z.string(), after: z.number() }).readonly(),
]);

/** A text's changes: the hunks (each change with three kept lines around it) and the lines added and removed. */
export const TextDiff = z
  .object({
    hunks: z.array(z.array(DiffLineSchema).readonly()).readonly(),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
  })
  .readonly();
export type TextDiff = z.infer<typeof TextDiff>;

/** One side of a cell in a notebook diff: where it is on that side and what it holds. `source` is left out of an
 * agent's answer, whose hunks say what changed. */
export const DiffCellSide = z
  .object({
    id: z.string(),
    index: z.number().int().nonnegative(),
    type: CellType,
    source: z.string().optional(),
    meta: z.record(z.string(), z.unknown()),
  })
  .readonly();
export type DiffCellSide = z.infer<typeof DiffCellSide>;

/** A key whose value differs between the two sides; a missing value is a key that side does not have. */
export const KeyChange = z
  .object({ key: z.string(), from: z.unknown().optional(), to: z.unknown().optional() })
  .readonly();
export type KeyChange = z.infer<typeof KeyChange>;

/** A cell's saved run changed: each side's status (none when that side saved no run) and what a reader sees change,
 * as cell.compare words it (a missing run compared as an empty one). */
export const OutputsChange = z
  .object({
    before: ExecStatus.optional(),
    after: ExecStatus.optional(),
    comparison: RunComparisonSchema,
  })
  .readonly();
export type OutputsChange = z.infer<typeof OutputsChange>;

export const DiffRowStatus = z.enum(["unchanged", "added", "removed", "modified"]);
export type DiffRowStatus = z.infer<typeof DiffRowStatus>;

/** One cell of a notebook diff: matched on both sides, added or removed. A cell whose source and type are kept but
 * whose meta (or unknown keys) changed is `modified` with `changes.meta` alone; one whose saved run (the file's
 * `outputs`) changed has `changes.outputs`. */
export const DiffRow = z
  .object({
    status: DiffRowStatus,
    moved: z.object({ from: z.number(), to: z.number() }).readonly().optional(),
    before: DiffCellSide.optional(),
    after: DiffCellSide.optional(),
    changes: z
      .object({
        source: TextDiff.optional(),
        type: z.object({ from: CellType, to: CellType }).readonly().optional(),
        meta: z.array(KeyChange).readonly().optional(),
        outputs: OutputsChange.optional(),
      })
      .readonly(),
  })
  .readonly();
export type DiffRow = z.infer<typeof DiffRow>;

export const NotebookDiff = z
  .object({
    /** Changes to `version`, `jsnb` and the file's unknown top-level keys. */
    header: z.array(KeyChange).readonly(),
    /** In the new order; a removed cell follows the nearest earlier cell that survived. */
    rows: z.array(DiffRow).readonly(),
    stats: z
      .object({
        added: z.number(),
        removed: z.number(),
        modified: z.number(),
        moved: z.number(),
        unchanged: z.number(),
      })
      .readonly(),
  })
  .readonly();
export type NotebookDiff = z.infer<typeof NotebookDiff>;

export const GitChangeStatus = z.enum([
  "modified",
  "added",
  "deleted",
  "renamed",
  "copied",
  "untracked",
  "typeChanged",
  "conflicted",
]);
export type GitChangeStatus = z.infer<typeof GitChangeStatus>;

/** A changed file, its path relative to the workspace folder; `from` is a rename's or a copy's old path. */
export const GitChange = z
  .object({
    path: z.string(),
    status: GitChangeStatus,
    from: z.string().optional(),
    notebook: z.boolean(),
  })
  .readonly();
export type GitChange = z.infer<typeof GitChange>;

export const GitBranch = z
  .object({
    /** The branch's name, or null on a detached HEAD. */
    name: z.string().nullable(),
    /** The commit HEAD names, or null before the first commit. */
    oid: z.string().nullable(),
    detached: z.boolean(),
    upstream: z.string().nullable(),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
  })
  .readonly();
export type GitBranch = z.infer<typeof GitBranch>;

export const GitState = z.enum([
  "clean",
  "merging",
  "rebasing",
  "cherryPicking",
  "reverting",
  "bisecting",
]);
export type GitState = z.infer<typeof GitState>;

export const GitRepo = z
  .object({
    /** The repository's top folder, absolute. */
    root: z.string(),
    /** The workspace folder inside it, `""` when it is the top, else `sub/dir/`. */
    prefix: z.string(),
    branch: GitBranch,
    state: GitState,
    staged: z.array(GitChange).readonly(),
    changes: z.array(GitChange).readonly(),
    conflicts: z.array(GitChange).readonly(),
    /** What is staged and changed outside the workspace folder: a commit takes the whole index. */
    outside: z.object({ staged: z.number(), changes: z.number() }).readonly(),
  })
  .readonly();
export type GitRepo = z.infer<typeof GitRepo>;
