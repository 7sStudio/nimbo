// The repository the workspace folder is in and its status: found with `git rev-parse` from the
// folder, read with `git status --porcelain=v2` over the whole repository, then split into the files under the folder
// (paths relative to it) and the counts outside it, since a commit takes the whole index.
import { access, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import type { GitChange, GitChangeStatus, GitRepo, GitState } from "@jsnb/core";
import { GitFailed } from "@jsnb/core";

import type { GitOptions } from "./exec.js";
import { git } from "./exec.js";
import type { PorcelainEntry } from "./porcelain.js";
import { branchOf, parsePorcelain } from "./porcelain.js";

export type RepoLocation = {
  /** The repository's top folder, resolved through links. */
  readonly top: string;
  /** Its git dir, absolute (a linked worktree's own). */
  readonly gitDir: string;
  /** The git dirs no workspace path may reach, resolved through links: its own and the common one (a linked
   * worktree's, a separate git dir's, the one a submodule's lives under). */
  readonly gitDirs: readonly string[];
  /** The workspace folder relative to `top`, with a trailing `/`, or `""`. */
  readonly prefix: string;
};

/** The repository `root` is in; undefined when it is in none or git is missing. */
export async function locate(
  root: string,
  options: GitOptions = {},
): Promise<RepoLocation | undefined> {
  const args = ["rev-parse", "--show-toplevel", "--absolute-git-dir", "--git-common-dir"];
  const run = await git(root, args, { ...options, read: true, allowFailure: true }).catch(
    (error: unknown) => {
      if (error instanceof GitFailed && error.data.code === null) return undefined; // no git binary
      throw error;
    },
  );
  if (run?.code !== 0) return undefined;
  const [top = "", gitDir = "", common = ""] = run.stdout.toString("utf8").trim().split("\n");
  if (top === "") return undefined; // a bare repository, or a folder inside the git dir itself
  const [realTop, realRoot] = await Promise.all([realpath(top), realpath(root)]);
  const inside = relative(realTop, realRoot).split(sep).join("/");
  const gitDirs = await Promise.all(
    [gitDir, resolve(root, common)].map((dir) => realpath(dir).catch(() => dir)),
  );
  return { top: realTop, gitDir, gitDirs, prefix: inside === "" ? "" : `${inside}/` };
}

const letters: Readonly<Record<string, GitChangeStatus>> = {
  M: "modified",
  T: "typeChanged",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
};

/** A status letter's name; an unknown letter reads as modified. */
const letterStatus = (letter: string): GitChangeStatus => letters[letter] ?? "modified";

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

/** What the repository is in the middle of, from the files git leaves in its dir. */
async function stateOf(gitDir: string): Promise<GitState> {
  const marks: readonly (readonly [string, GitState])[] = [
    ["rebase-merge", "rebasing"],
    ["rebase-apply", "rebasing"],
    ["MERGE_HEAD", "merging"],
    ["CHERRY_PICK_HEAD", "cherryPicking"],
    ["REVERT_HEAD", "reverting"],
    ["BISECT_LOG", "bisecting"],
  ];
  for (const [file, state] of marks) if (await exists(join(gitDir, file))) return state;
  return "clean";
}

type Lists = {
  readonly staged: GitChange[];
  readonly changes: GitChange[];
  readonly conflicts: GitChange[];
  readonly outside: { staged: number; changes: number };
};

/** The record's path made relative to the workspace folder, or undefined outside it. */
const localTo =
  (prefix: string) =>
  (path: string): string | undefined =>
    path.startsWith(prefix) ? path.slice(prefix.length) : undefined;

/** A rename's or a copy's old path: relative to the folder, or `../<path>` when it was outside it. */
function fromOf(
  entry: PorcelainEntry,
  local: (path: string) => string | undefined,
): { from?: string } {
  if (entry.from === undefined) return {};
  return { from: local(entry.from) ?? `../${entry.from}` };
}

/** Where one record of the status goes: its staged and its working-tree side, or a conflict. */
function place(lists: Lists, entry: PorcelainEntry, prefix: string): void {
  const local = localTo(prefix);
  const path = local(entry.path);
  const conflicted = entry.kind === "u";
  const staged = !conflicted && entry.x !== "." && entry.x !== "?";
  const changed = !conflicted && entry.y !== ".";
  if (path === undefined) {
    lists.outside.staged += Number(staged);
    lists.outside.changes += Number(changed || conflicted);
    return;
  }
  const notebook = path.endsWith(".jsnb");
  if (conflicted) lists.conflicts.push({ path, status: "conflicted", notebook });
  if (staged)
    lists.staged.push({ path, status: letterStatus(entry.x), notebook, ...fromOf(entry, local) });
  if (changed) {
    const status = entry.kind === "?" ? "untracked" : letterStatus(entry.y);
    lists.changes.push({ path, status, notebook });
  }
}

const byPath = (a: GitChange, b: GitChange): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/** The status of the repository at `location`, the lists holding the files under the workspace folder. */
export async function statusOf(location: RepoLocation, options: GitOptions = {}): Promise<GitRepo> {
  const args = ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"];
  const run = await git(location.top, args, { ...options, read: true });
  const { headers, entries } = parsePorcelain(run.stdout.toString("utf8"));
  const lists: Lists = {
    staged: [],
    changes: [],
    conflicts: [],
    outside: { staged: 0, changes: 0 },
  };
  for (const entry of entries) place(lists, entry, location.prefix);
  return {
    root: location.top,
    prefix: location.prefix,
    branch: branchOf(headers),
    state: await stateOf(location.gitDir),
    staged: lists.staged.sort(byPath),
    changes: lists.changes.sort(byPath),
    conflicts: lists.conflicts.sort(byPath),
    outside: lists.outside,
  };
}
