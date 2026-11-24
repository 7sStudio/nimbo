// The Source Control commands of 03-api §4.13: the repository's status, a file's diff (a notebook's
// cell by cell), and the whole-file writes of v1: stage, unstage, discard and commit.
import { z } from "zod";

import { GitRepo, NotebookDiff, TextDiff } from "../model/gitDiff.js";
import { defineCommand } from "./define.js";

const paths = z.array(z.string().min(1)).min(1).readonly();

export const gitStatus = defineCommand({
  name: "git.status",
  description:
    "The git repository the workspace folder is in: the branch, the state (merging, rebasing) and the changed files under the folder as staged, changes (unstaged and untracked) and conflicts, paths relative to the workspace. repo is null when the folder is in no repository or git is not installed.",
  input: z.object({}),
  output: z.object({ repo: GitRepo.nullable() }),
});

export const gitDiff = defineCommand({
  name: "git.diff",
  description:
    "One file's changes: the index against the working tree, HEAD against the index with staged, or base (a revision) against the working tree. A .jsnb file is diffed cell by cell (rows matched by cell id, each with its source hunks, a type change, meta changes and its saved run's changes; the changed cells only, stats counting the rest); another text file as line hunks. A staged rename names its old path in renamedFrom. Narrow a notebook to one cell with cell; content adds both sides' full text and every row. Read a notebook's changes with this, not by diffing its JSON.",
  input: z.object({
    path: z.string().min(1),
    staged: z.boolean().default(false),
    base: z.string().min(1).optional(),
    cell: z.string().min(1).optional(),
    content: z.boolean().default(false),
  }),
  output: z.object({
    path: z.string(),
    /** A staged rename's old path: the old side is read there. */
    renamedFrom: z.string().optional(),
    /** What the old side is: `HEAD`, `index`, a revision, or `none` for a new file. */
    from: z.string(),
    /** What the new side is: `index`, `worktree`, or `none` for a deleted file. */
    to: z.string(),
    kind: z.enum(["notebook", "text", "binary", "tooLarge"]),
    /** Why a .jsnb file was diffed as text: a side that does not parse (conflict markers, broken JSON). */
    reason: z.literal("notebookUnreadable").optional(),
    notebook: NotebookDiff.optional(),
    text: TextDiff.optional(),
    before: z.string().optional(),
    after: z.string().optional(),
  }),
});

export const gitStage = defineCommand({
  name: "git.stage",
  description:
    "Stage whole files (git add); an open notebook's unsaved edits are saved first, so what is staged is what the page shows.",
  input: z.object({ paths }),
  output: z.object({}),
  tags: { mutating: true, idempotent: true },
});

export const gitUnstage = defineCommand({
  name: "git.unstage",
  description: "Unstage whole files (git restore --staged); the working tree keeps its changes.",
  input: z.object({ paths }),
  output: z.object({}),
  tags: { mutating: true, idempotent: true },
});

export const gitDiscard = defineCommand({
  name: "git.discard",
  description:
    "Discard the working tree's changes to files: a tracked file goes back to the index, an untracked one is deleted. An open notebook reloads. Cannot be undone.",
  input: z.object({ paths }),
  output: z.object({}),
  tags: { mutating: true, destructive: true },
});

export const gitCommit = defineCommand({
  name: "git.commit",
  description:
    "Commit the index with a message, as git commit does (hooks, signing and identity apply); with all, stage every change under the workspace folder first. Open notebooks are saved first.",
  input: z.object({ message: z.string().trim().min(1), all: z.boolean().default(false) }),
  output: z.object({ oid: z.string(), branch: z.string().nullable(), summary: z.string() }),
  tags: { mutating: true },
});
