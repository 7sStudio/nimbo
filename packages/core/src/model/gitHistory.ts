// The shapes of Source Control beyond the status: branches and remotes, commits of the log, stashes, and what a pull
// did. Remote URLs are redacted: a token in `https://user:token@host/` never leaves the daemon.
import { z } from "zod";

import { GitChange } from "./gitDiff.js";

export const GitCommitSummary = z.object({
  oid: z.string(),
  short: z.string(),
  parents: z.array(z.string()).readonly(),
  author: z.string(),
  email: z.string(),
  /** The author date, ISO 8601. */
  date: z.string(),
  subject: z.string(),
});

export type GitCommitSummary = z.infer<typeof GitCommitSummary>;

export const GitLocalBranch = z
  .object({
    name: z.string(),
    current: z.boolean(),
    oid: z.string(),
    /** `origin/main`, or null without one. */
    upstream: z.string().nullable(),
    /** The upstream is configured but its branch no longer exists on the remote. */
    gone: z.boolean(),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    date: z.string(),
    subject: z.string(),
  })
  .readonly();
export type GitLocalBranch = z.infer<typeof GitLocalBranch>;

export const GitRemoteBranch = z
  .object({
    /** `origin/main`. */
    name: z.string(),
    remote: z.string(),
    oid: z.string(),
    date: z.string(),
    subject: z.string(),
  })
  .readonly();
export type GitRemoteBranch = z.infer<typeof GitRemoteBranch>;

export const GitRemote = z
  .object({ name: z.string(), url: z.string(), pushUrl: z.string() })
  .readonly();
export type GitRemote = z.infer<typeof GitRemote>;

export const GitStashEntry = z
  .object({
    index: z.number().int().nonnegative(),
    oid: z.string(),
    /** git's own line: `On main: message` or `WIP on main: …`. */
    message: z.string(),
    date: z.string(),
  })
  .readonly();
export type GitStashEntry = z.infer<typeof GitStashEntry>;

/** How a pull reconciled: the configured strategy (branch.<name>.rebase, else pull.rebase; pull.ff=only) or the one
 * asked for. */
export const GitPullStrategy = z.enum(["merge", "rebase", "fastForwardOnly"]);

export const GitPullOutcome = z.object({
  strategy: GitPullStrategy,
  result: z.enum(["upToDate", "fastForward", "merged", "rebased", "conflicts"]),
  /** The conflicted files under the workspace folder when the pull stopped; abort or resolve and commit. */
  conflicts: z.array(z.string()).readonly(),
});

export type GitPullOutcome = z.infer<typeof GitPullOutcome>;

export const GitCommitDetail = z.object({
  ...GitCommitSummary.shape,
  body: z.string(),
  /** The files it changed under the workspace folder, against its first parent. */
  files: z.array(GitChange).readonly(),
  /** How many files it changed outside the workspace folder. */
  outside: z.number().int().nonnegative(),
});
