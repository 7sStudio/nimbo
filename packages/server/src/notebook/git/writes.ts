// The whole-file writes: stage, unstage, discard and commit, as git does them, with
// the open notebooks kept in step: staged and committed notebooks are saved first, so what git takes is what the page
// shows; a discarded one is reloaded by the daemon itself, so the page sees no conflict for a change the app made.
// Every path is taken literally (--literal-pathspecs: `glob[1].txt` is a name, not a pattern) and follows `--`.
import { rm } from "node:fs/promises";
import { join } from "node:path";

import type { z } from "zod";

import type { gitCommit } from "@jsnb/core";

import type { Session } from "../session/session.js";
import type { GitContext } from "./context.js";
import { required, saveOpen, sessionOf } from "./context.js";
import { checkPath } from "./paths.js";
import { statusOf } from "./status.js";

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

export async function discard(context: GitContext, paths: readonly string[]): Promise<void> {
  const found = await required(context);
  const list = await checked(context, paths);
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

export async function commit(
  context: GitContext,
  input: { readonly message: string; readonly all: boolean },
): Promise<CommitOutput> {
  await required(context);
  if (input.all) {
    await saveOpen(context, "all");
    await context.run(context.root, ["add", "-A", "--", "."]);
  }
  const done = await context.run(context.root, ["commit", "-m", input.message]);
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
    summary: done.stdout.toString("utf8").trim().split("\n")[0] ?? "",
  };
}
