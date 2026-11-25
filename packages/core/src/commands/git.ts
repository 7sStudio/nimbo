// The Source Control commands of 03-api §4.15: the repository's status, a file's diff (a notebook's
// cell by cell), the whole-file writes (stage, unstage, discard, commit and amend) and init. Remotes, branches, stash
// and history are in gitRemote.ts, gitBranch.ts, gitStash.ts and gitHistory.ts. A command that can lose work takes
// `confirm`, which the page sets from a dialog and the CLI from --yes.
import { z } from "zod";

import { GitRepo, NotebookDiff, TextDiff } from "../model/gitDiff.js";
import { defineCommand } from "./define.js";

const paths = z.array(z.string().min(1)).min(1).readonly();

/** The explicit yes of a command that can lose work; without it the command refuses (GitFailed, reason confirm). */
export const gitConfirm = z.boolean().default(false);

export const gitStatus = defineCommand({
  name: "git.status",
  description:
    "The git repository the workspace folder is in: the branch, the state (merging, rebasing) and the changed files under the folder as staged, changes (unstaged and untracked) and conflicts, paths relative to the workspace. repo is null when the folder is in no repository or git is not installed. running names the git write under way (from any page, the CLI or an agent), else null.",
  input: z.object({}),
  output: z.object({ repo: GitRepo.nullable(), running: z.string().nullable() }),
});

export const gitDiff = defineCommand({
  name: "git.diff",
  description:
    "One file's changes: the index against the working tree, HEAD against the index with staged, base (a revision) against the working tree, or commit against its first parent (the file as that commit changed it). A .jsnb file is diffed cell by cell (rows matched by cell id, each with its source hunks, a type change, meta changes and its saved run's changes; the changed cells only, stats counting the rest); another text file as line hunks. A staged rename names its old path in renamedFrom. Narrow a notebook to one cell with cell; content adds both sides' full text and every row. Read a notebook's changes with this, not by diffing its JSON.",
  input: z.object({
    path: z.string().min(1),
    staged: z.boolean().default(false),
    base: z.string().min(1).optional(),
    commit: z.string().min(1).optional(),
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
    kind: z.enum(["notebook", "text", "binary", "tooLarge", "submodule"]),
    /** A submodule's change: the commit each side records, null where that side has none. */
    submodule: z.object({ before: z.string().nullable(), after: z.string().nullable() }).optional(),
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
    "Changes the index: stage whole files (git add); an open notebook's unsaved edits are saved first, so what is staged is what the page shows.",
  input: z.object({ paths }),
  output: z.object({}),
  tags: { mutating: true, idempotent: true },
});

export const gitUnstage = defineCommand({
  name: "git.unstage",
  description:
    "Changes the index: unstage whole files (git restore --staged); the working tree keeps its changes.",
  input: z.object({ paths }),
  output: z.object({}),
  tags: { mutating: true, idempotent: true },
});

export const gitDiscard = defineCommand({
  name: "git.discard",
  description:
    "Changes the working tree: discard the changes to files, a tracked file going back to the index, an untracked one deleted; an open notebook is saved, then takes the file back by cell. Cannot be undone, so it refuses without confirm: true.",
  input: z.object({ paths, confirm: gitConfirm }),
  output: z.object({}),
  tags: { mutating: true, destructive: true },
});

export const gitCommit = defineCommand({
  name: "git.commit",
  description:
    "Changes the repository: commit the index with a message, as git commit does (hooks, signing and identity apply); with all, stage every change under the workspace folder first. Open notebooks are saved first. amend replaces the last commit with the index (its message kept when message is left out); amending a commit the upstream already has needs confirm: true.",
  input: z.object({
    message: z.string().trim().optional(),
    all: z.boolean().default(false),
    amend: z.boolean().default(false),
    confirm: gitConfirm,
  }),
  output: z.object({ oid: z.string(), branch: z.string().nullable(), summary: z.string() }),
  tags: { mutating: true },
});

export const gitInit = defineCommand({
  name: "git.init",
  description:
    "Changes the workspace: initialize a git repository in the workspace folder (git init, with the user's init.defaultBranch and templates). Refuses when the folder is already in a repository.",
  input: z.object({}),
  output: z.object({ root: z.string(), branch: z.string().nullable() }),
  tags: { mutating: true },
});
