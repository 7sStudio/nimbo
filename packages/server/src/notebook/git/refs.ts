// Small reads the remote, branch and stash operations share: HEAD's commit, a config value, the remotes, whether one
// commit is an ancestor of another, and the conflicted files once an operation stopped.
import type { GitRepo } from "@jsnb/core";

import type { GitContext } from "./context.js";
import type { RepoLocation } from "./status.js";
import { statusOf } from "./status.js";
import { refusal } from "./tree.js";

const text = (buffer: Buffer): string => buffer.toString("utf8").trim();

/** The commit HEAD names, or null before the first commit. */
export async function headOid(context: GitContext, found: RepoLocation): Promise<string | null> {
  const run = await context.run(found.top, ["rev-parse", "--verify", "--quiet", "HEAD"], {
    read: true,
    allowFailure: true,
  });
  return run.code === 0 ? text(run.stdout) : null;
}

/** A config value as git resolves it (repository, user, system), or "" when unset. */
export async function configValue(
  context: GitContext,
  found: RepoLocation,
  key: string,
): Promise<string> {
  const run = await context.run(found.top, ["config", "--get", key], {
    read: true,
    allowFailure: true,
  });
  return run.code === 0 ? text(run.stdout) : "";
}

export async function remoteNames(context: GitContext, found: RepoLocation): Promise<string[]> {
  const run = await context.run(found.top, ["remote"], { read: true });
  return text(run.stdout)
    .split("\n")
    .filter((name) => name !== "");
}

/** Whether `ancestor` is reachable from `of`. */
export async function isAncestor(
  context: GitContext,
  found: RepoLocation,
  ancestor: string,
  of: string,
): Promise<boolean> {
  const args = ["merge-base", "--is-ancestor", "--end-of-options", ancestor, of];
  const run = await context.run(found.top, args, { read: true, allowFailure: true });
  return run.code === 0;
}

/** The current branch's name; a detached HEAD refuses `command`. */
export function branchName(repo: GitRepo, command: string): string {
  if (repo.branch.name === null)
    throw refusal(command, "detached", "HEAD is detached: switch to a branch first");
  return repo.branch.name;
}

/** The conflicted files under the workspace folder now. */
export async function conflictsNow(context: GitContext, found: RepoLocation): Promise<string[]> {
  const repo = await statusOf(found, context.options);
  return repo.conflicts.map((change) => change.path);
}

/** Whether tracked files hold changes (staged, unstaged or conflicted); untracked ones do not count. */
export const hasTrackedChanges = (repo: GitRepo): boolean =>
  repo.staged.length + repo.conflicts.length > 0 ||
  repo.changes.some((change) => change.status !== "untracked") ||
  repo.outside.staged + repo.outside.changes > 0;
