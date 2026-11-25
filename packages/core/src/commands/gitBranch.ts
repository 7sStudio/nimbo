// The branches of Source Control (03-api §4.15): list, create, switch, rename and delete, as VS Code's branch picker
// and JetBrains' Branches popup do them. A name is checked as git check-ref-format --branch does, and never starts
// with `-`. A switch merges each file it rewrites into its open notebook by cell, so no unsaved edit is lost.
import { z } from "zod";

import { GitLocalBranch, GitRemote, GitRemoteBranch } from "../model/gitHistory.js";
import { defineCommand } from "./define.js";
import { gitConfirm } from "./git.js";

const name = z.string().min(1);

export const gitBranches = defineCommand({
  name: "git.branches",
  description:
    "The local branches (the current one marked, each with its upstream, ahead and behind, last commit), the remote-tracking branches and the remotes (URLs with credentials redacted), most recent commit first.",
  input: z.object({}),
  output: z.object({
    current: z.string().nullable(),
    local: z.array(GitLocalBranch).readonly(),
    remote: z.array(GitRemoteBranch).readonly(),
    remotes: z.array(GitRemote).readonly(),
  }),
});

export const gitBranchCreate = defineCommand({
  name: "git.branchCreate",
  description:
    "Changes the repository: create branch name at start (a branch, a remote branch such as origin/main, which becomes its upstream, or a commit; HEAD by default) and switch to it unless switch: false. Fails with reason exists when the name is taken.",
  input: z.object({ name, start: z.string().min(1).optional(), switch: z.boolean().default(true) }),
  output: z.object({ branch: z.string() }),
  tags: { mutating: true },
});

export const gitSwitch = defineCommand({
  name: "git.switch",
  description:
    "Changes the working tree: switch to branch, a local branch or a remote one (origin/feature makes a local feature tracking it). Open notebooks keep their unsaved edits; each file it rewrites is merged into its open notebook by cell after (a cell both changed is a conflict). When changes in the working tree would be overwritten git refuses (reason localChanges, the files named); stash: true stashes every change first, untracked files too (git stash push -u), and leaves the stash for git.stashPop.",
  input: z.object({ branch: name, stash: z.boolean().default(false) }),
  output: z.object({ branch: z.string(), stashed: z.boolean() }),
  tags: { mutating: true },
});

export const gitBranchRename = defineCommand({
  name: "git.branchRename",
  description:
    "Changes the repository: rename branch name (the current one by default) to to; its upstream is kept. Fails with reason exists when to is taken.",
  input: z.object({ name: name.optional(), to: name }),
  output: z.object({ branch: z.string() }),
  tags: { mutating: true },
});

export const gitBranchDelete = defineCommand({
  name: "git.branchDelete",
  description:
    "Changes the repository: delete local branch name (git branch -d). A branch whose commits are on no other branch or upstream fails with reason unmerged; force: true deletes it anyway (git branch -D), which can lose those commits, so force needs confirm: true. The current branch cannot be deleted.",
  input: z.object({ name, force: z.boolean().default(false), confirm: gitConfirm }),
  output: z.object({ branch: z.string(), oid: z.string() }),
  tags: { mutating: true },
});
