// The whole-file writes: stage, unstage, discard, commit (and amend) and init, as git does them, with
// the open notebooks kept in step: staged and committed notebooks are saved first, so what git takes is what the page
// shows; a discarded one is reloaded by the daemon itself, so the page sees no conflict for a change the app made.
// Every path is taken literally (--literal-pathspecs: `glob[1].txt` is a name, not a pattern) and follows `--`.
import { rm } from "node:fs/promises";
import { join } from "node:path";

import type { z } from "zod";

import type { gitCommit } from "@jsnb/core";
import { InvalidParams } from "@jsnb/core";

import type { Session } from "../session/session.js";
import type { GitContext } from "./context.js";
import { required, saveOpen, sessionOf } from "./context.js";
import { checkMessage, checkPath } from "./paths.js";
import { isAncestor } from "./refs.js";
import { locate, statusOf } from "./status.js";
import { refusal } from "./tree.js";

type CommitOutput = z.input<typeof gitCommit.output>;

const checked = (context: GitContext, paths: readonly string[]) =>
  Promise.all(paths.map((path) => checkPath(context.root, path, "paths")));

export async function stage(context: GitContext, paths: readonly string[]): Promise<void> {
  await required(context);
  const list = await checked(context, paths);
  await saveOpen(context, list);
  await context.run(context.root, ["--literal-pathspecs", "add", "--", ...list]);
}

export async function unstage(context: GitContext, paths: readonly string[]): Promise<void> {
  const found = await required(context);
  const list = await checked(context, paths);
  const repo = await statusOf(found, context.options);
  // before the first commit there is no HEAD to restore the index from
  const args =
    repo.branch.oid === null ? ["rm", "--cached", "-r", "-q", "--"] : ["restore", "--staged", "--"];
  await context.run(context.root, ["--literal-pathspecs", ...args, ...list]);
}

/** Deletes untracked files (an open notebook among them is closed first). */
async function removeUntracked(context: GitContext, paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    if (context.notebooks.openRefs().includes(path)) await context.notebooks.close(path);
    await rm(join(context.root, ...path.split("/")), { force: true });
  }
}

export async function discard(
  context: GitContext,
  paths: readonly string[],
  confirm: boolean,
): Promise<void> {
  const found = await required(context);
  const list = await checked(context, paths);
  if (!confirm)
    throw refusal(
      "restore",
      "confirm",
      "discarding changes cannot be undone: discard with confirm",
    );
  const repo = await statusOf(found, context.options);
  const untracked = new Set(
    repo.changes.filter((change) => change.status === "untracked").map((change) => change.path),
  );
  await removeUntracked(
    context,
    list.filter((path) => untracked.has(path)),
  );
  const tracked = list.filter((path) => !untracked.has(path));
  if (tracked.length === 0) return;
  const sessions = await Promise.all(tracked.map((path) => sessionOf(context, path)));
  const open = sessions.filter((session): session is Session => session !== undefined);
  // nothing is left waiting to be autosaved over what git puts back
  for (const session of open) await session.save(true).catch(() => undefined);
  await context.run(context.root, [
    "--literal-pathspecs",
    "restore",
    "--worktree",
    "--",
    ...tracked,
  ]);
  for (const session of open) await session.reload();
}

type CommitInput = {
  readonly message?: string | undefined;
  readonly all: boolean;
  readonly amend: boolean;
  readonly confirm: boolean;
};

/** An amend of a commit the upstream already has rewrites published history: it needs the explicit yes. */
async function checkAmend(context: GitContext, input: CommitInput): Promise<void> {
  const found = await required(context);
  const repo = await statusOf(found, context.options);
  if (repo.branch.oid === null) throw refusal("commit", undefined, "there is no commit to amend");
  const { upstream } = repo.branch;
  if (upstream === null || input.confirm) return;
  if (await isAncestor(context, found, "HEAD", `refs/remotes/${upstream}`))
    throw refusal(
      "commit",
      "confirm",
      `the last commit is already on ${upstream}: amending rewrites it (a force push follows); amend with confirm`,
    );
}

/** The message a commit takes: required unless it amends (which then keeps the last one). */
function messageOf(input: CommitInput): string {
  const message = input.message?.trim() ?? "";
  if (message === "" && !input.amend)
    throw new InvalidParams({
      issues: [{ path: ["message"], message: "a commit needs a message" }],
    });
  return message === "" ? message : checkMessage(message);
}

/** The commit made: its oid, the branch it is on (null on a detached HEAD) and git's summary line. */
async function made(context: GitContext, summary: string): Promise<CommitOutput> {
  const [oid, name] = await Promise.all([
    context.run(context.root, ["rev-parse", "HEAD"], { read: true }),
    context.run(context.root, ["symbolic-ref", "--short", "-q", "HEAD"], {
      read: true,
      allowFailure: true,
    }),
  ]);
  const branch = name.stdout.toString("utf8").trim();
  return {
    oid: oid.stdout.toString("utf8").trim(),
    branch: branch === "" ? null : branch,
    summary: summary.trim().split("\n")[0] ?? "",
  };
}

export async function commit(context: GitContext, input: CommitInput): Promise<CommitOutput> {
  await required(context);
  const message = messageOf(input);
  if (input.amend) await checkAmend(context, input);
  if (input.all) {
    await saveOpen(context, "all");
    await context.run(context.root, ["add", "-A", "--", "."]);
  }
  const args = [
    "commit",
    ...(input.amend ? ["--amend"] : []),
    message === "" ? "--no-edit" : `--message=${message}`,
  ];
  const done = await context.run(context.root, args);
  return made(context, done.stdout.toString("utf8"));
}

export async function init(context: GitContext): Promise<{ root: string; branch: string | null }> {
  const found = await locate(context.root, context.options);
  if (found !== undefined)
    throw refusal(
      "init",
      "exists",
      `the workspace folder is already in a repository at ${found.top}`,
    );
  const inside = await context.run(
    context.root,
    ["rev-parse", "--is-inside-git-dir", "--is-bare-repository"],
    { read: true, allowFailure: true },
  );
  if (inside.code === 0 && inside.stdout.toString("utf8").includes("true"))
    throw refusal(
      "init",
      "exists",
      "the workspace folder is inside a bare repository or a .git folder: open a folder outside it",
    );
  await context.run(context.root, ["init", "--quiet"]);
  const made = await required(context);
  const name = await context.run(made.top, ["symbolic-ref", "--short", "-q", "HEAD"], {
    read: true,
    allowFailure: true,
  });
  const branch = name.stdout.toString("utf8").trim();
  return { root: made.top, branch: branch === "" ? null : branch };
}
