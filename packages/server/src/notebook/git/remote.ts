// fetch, pull, push, publish and sync (03-api §4.15) through the user's git: its remotes, credentials and pull
// strategy. A pull that stops on conflicts is an answer, not an error: the repository is left merging or rebasing for
// the user to resolve, continue or abort (abortOperation, continueOperation).
import type { GitPullOutcome, GitState } from "@jsnb/core";

import type { GitContext } from "./context.js";
import { required, withOpenEdits } from "./context.js";
import type { GitOptions } from "./exec.js";
import { failureOf } from "./exec.js";
import { checkRemote } from "./paths.js";
import {
  branchName,
  configValue,
  conflictsNow,
  hasTrackedChanges,
  headOid,
  isAncestor,
  remoteNames,
} from "./refs.js";
import type { RepoLocation } from "./status.js";
import { statusOf } from "./status.js";
import { refusal, treeChange } from "./tree.js";

/** A long operation's signal and progress. */
export type Long = Pick<GitOptions, "signal" | "onProgress" | "onHardKill">;

type Strategy = GitPullOutcome["strategy"];

export async function fetchRemote(
  context: GitContext,
  input: { readonly remote?: string | undefined; readonly all: boolean; readonly prune: boolean },
  long: Long,
): Promise<void> {
  const found = await required(context);
  const names = await remoteNames(context, found);
  if (names.length === 0) throw refusal("fetch", "noRemote", "this repository has no remote");
  const which = input.all
    ? ["--all"]
    : input.remote === undefined
      ? []
      : ["--end-of-options", checkRemote(input.remote, names)];
  const args = ["fetch", "--progress", ...(input.prune ? ["--prune"] : []), ...which];
  await context.run(found.top, args, long);
}

/** The strategy git pull takes without flags: branch.<name>.rebase, else pull.rebase; pull.ff=only. */
async function configuredStrategy(
  context: GitContext,
  found: RepoLocation,
  branch: string,
): Promise<Strategy> {
  const rebase =
    (await configValue(context, found, `branch.${branch}.rebase`)) ||
    (await configValue(context, found, "pull.rebase"));
  if (rebase !== "" && rebase !== "false") return "rebase";
  return (await configValue(context, found, "pull.ff")) === "only" ? "fastForwardOnly" : "merge";
}

/** What moved HEAD from `before` to `after`. */
async function resultOf(
  context: GitContext,
  found: RepoLocation,
  before: string | null,
  after: string | null,
): Promise<GitPullOutcome["result"]> {
  if (before === after || after === null) return "upToDate";
  if (before === null) return "fastForward";
  if (!(await isAncestor(context, found, before, after))) return "rebased";
  const parents = await context.run(found.top, ["rev-list", "--parents", "-n", "1", after], {
    read: true,
  });
  const ids = parents.stdout.toString("utf8").trim().split(" ").slice(1);
  return ids.length > 1 && ids[0] === before ? "merged" : "fastForward";
}

const stopped = (state: GitState): boolean => state === "merging" || state === "rebasing";

export type PullInput = { readonly rebase?: boolean | undefined; readonly confirm: boolean };

export async function pull(
  context: GitContext,
  input: PullInput,
  long: Long,
): Promise<GitPullOutcome> {
  const found = await required(context);
  const repo = await withOpenEdits(context, found, await statusOf(found, context.options));
  const branch = branchName(repo, "pull");
  if (repo.branch.upstream === null)
    throw refusal("pull", "noUpstream", `${branch} has no upstream branch: publish it first`);
  if (hasTrackedChanges(repo) && !input.confirm)
    throw refusal(
      "pull",
      "confirm",
      "the working tree has changes: commit or stash them, or pull with confirm (aborting a conflicted pull may not restore them)",
    );
  const strategy =
    input.rebase === undefined
      ? await configuredStrategy(context, found, branch)
      : input.rebase
        ? "rebase"
        : "merge";
  const flags = input.rebase === undefined ? [] : [input.rebase ? "--rebase" : "--no-rebase"];
  return treeChange(context, async () => {
    const before = await headOid(context, found);
    const run = await context.run(found.top, ["pull", "--progress", ...flags], {
      ...long,
      allowFailure: true,
    });
    if (run.code !== 0) {
      const now = await statusOf(found, context.options);
      if (stopped(now.state) && now.conflicts.length > 0 && long.signal?.aborted !== true)
        return { strategy, result: "conflicts", conflicts: await conflictsNow(context, found) };
      if (long.signal?.aborted === true) throw refusal("pull", "cancelled", "cancelled");
      throw failureOf("pull", run.code, run.stderr || run.stdout.toString("utf8"));
    }
    const after = await headOid(context, found);
    return { strategy, result: await resultOf(context, found, before, after), conflicts: [] };
  });
}

export async function push(
  context: GitContext,
  long: Long,
): Promise<{ branch: string; upstream: string }> {
  const found = await required(context);
  const repo = await statusOf(found, context.options);
  const branch = branchName(repo, "push");
  const { upstream } = repo.branch;
  if (upstream === null)
    throw refusal("push", "noUpstream", `${branch} has no upstream branch: publish it`);
  await context.run(found.top, ["push", "--progress"], long);
  return { branch, upstream };
}

/** The remote a publish goes to: the one asked for, the only one, else origin. */
async function publishRemote(
  context: GitContext,
  found: RepoLocation,
  asked: string | undefined,
): Promise<string> {
  const names = await remoteNames(context, found);
  if (asked !== undefined) return checkRemote(asked, names);
  if (names.length === 0)
    throw refusal("push", "noRemote", "this repository has no remote: add one (git remote add)");
  const [only] = names;
  if (names.length === 1 && only !== undefined) return only;
  if (names.includes("origin")) return "origin";
  throw refusal("push", "noRemote", `choose a remote: ${names.join(", ")}`);
}

export async function publish(
  context: GitContext,
  input: { readonly remote?: string | undefined },
  long: Long,
): Promise<{ branch: string; upstream: string }> {
  const found = await required(context);
  const repo = await statusOf(found, context.options);
  const branch = branchName(repo, "push");
  const remote = await publishRemote(context, found, input.remote);
  const ref = `refs/heads/${branch}`;
  const args = [
    "push",
    "--progress",
    "--set-upstream",
    "--end-of-options",
    remote,
    `${ref}:${ref}`,
  ];
  await context.run(found.top, args, long);
  return { branch, upstream: `${remote}/${branch}` };
}

export async function sync(
  context: GitContext,
  input: PullInput,
  long: Long,
): Promise<{ pull: GitPullOutcome; pushed: boolean }> {
  const outcome = await pull(context, input, long);
  if (outcome.result === "conflicts") return { pull: outcome, pushed: false };
  await push(context, long);
  return { pull: outcome, pushed: true };
}

type InProgress = "merge" | "rebase" | "cherryPick" | "revert";

const inProgress: Partial<Record<GitState, { name: InProgress; git: string }>> = {
  merging: { name: "merge", git: "merge" },
  rebasing: { name: "rebase", git: "rebase" },
  cherryPicking: { name: "cherryPick", git: "cherry-pick" },
  reverting: { name: "revert", git: "revert" },
};

async function underWay(context: GitContext, command: string) {
  const found = await required(context);
  const repo = await statusOf(found, context.options);
  const operation = inProgress[repo.state];
  if (operation === undefined)
    throw refusal(command, undefined, "no merge, rebase, cherry-pick or revert is under way");
  return { found, operation };
}

export async function abortOperation(
  context: GitContext,
  input: { readonly confirm: boolean },
): Promise<{ aborted: InProgress }> {
  const { found, operation } = await underWay(context, "abort");
  if (!input.confirm)
    throw refusal(
      "abort",
      "confirm",
      `aborting the ${operation.git} loses the resolutions made so far: abort with confirm`,
    );
  await treeChange(context, () => context.run(found.top, [operation.git, "--abort"]));
  return { aborted: operation.name };
}

export async function continueOperation(context: GitContext): Promise<{
  continued: InProgress;
  result: "done" | "conflicts";
  conflicts: string[];
}> {
  const { found, operation } = await underWay(context, "continue");
  const args = operation.name === "merge" ? ["commit", "--no-edit"] : [operation.git, "--continue"];
  return treeChange(context, async () => {
    const run = await context.run(found.top, args, { allowFailure: true });
    const conflicts = await conflictsNow(context, found);
    if (run.code !== 0 && conflicts.length === 0)
      throw failureOf(operation.git, run.code, run.stderr || run.stdout.toString("utf8"));
    return {
      continued: operation.name,
      result: conflicts.length > 0 ? "conflicts" : "done",
      conflicts,
    };
  });
}
