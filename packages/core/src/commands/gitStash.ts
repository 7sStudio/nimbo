// The stash of Source Control (03-api §4.15): push, list, apply, pop and drop. A stash is named by its index in
// git.stashList; passing its oid too makes a command refuse when the list changed meanwhile.
import { z } from "zod";

import { GitStashEntry } from "../model/gitHistory.js";
import { defineCommand } from "./define.js";
import { gitConfirm } from "./git.js";

const entry = z.object({
  index: z.number().int().nonnegative(),
  oid: z.string().min(1).optional(),
});

const applied = z.object({
  result: z.enum(["applied", "conflicts"]),
  /** The conflicted files under the workspace folder; a conflicted pop keeps its stash. */
  conflicts: z.array(z.string()).readonly(),
});

export const gitStash = defineCommand({
  name: "git.stash",
  description:
    "Changes the working tree: stash the changes (git stash push), with message, and untracked files too with untracked. Open notebooks keep their unsaved edits; each file it rewrites is merged into its open notebook by cell after (a cell both changed is a conflict). Answers created: false when there was nothing to stash.",
  input: z.object({
    message: z.string().optional(),
    untracked: z.boolean().default(false),
  }),
  output: z.object({ created: z.boolean() }),
  tags: { mutating: true },
});

export const gitStashList = defineCommand({
  name: "git.stashList",
  description: "The stashes, newest first (index 0 is stash@{0}).",
  input: z.object({}),
  output: z.object({ stashes: z.array(GitStashEntry).readonly() }),
});

export const gitStashApply = defineCommand({
  name: "git.stashApply",
  description:
    "Changes the working tree: apply a stash and keep it. Changes it would overwrite make git refuse (reason localChanges); a conflict answers result conflicts. Open notebooks take their files' changes by cell.",
  input: entry,
  output: applied,
  tags: { mutating: true },
});

export const gitStashPop = defineCommand({
  name: "git.stashPop",
  description:
    "Changes the working tree: apply a stash and drop it, unless it conflicts (result conflicts, the stash kept). Open notebooks take their files' changes by cell.",
  input: entry,
  output: applied,
  tags: { mutating: true },
});

export const gitStashDrop = defineCommand({
  name: "git.stashDrop",
  description:
    "Changes the repository: delete a stash. Cannot be undone, so it refuses without confirm: true.",
  input: entry.extend({ confirm: gitConfirm }),
  output: z.object({ oid: z.string() }),
  tags: { mutating: true, destructive: true },
});
