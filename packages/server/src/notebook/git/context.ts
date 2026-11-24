// What the parts of the git service share (service.ts): the workspace folder, the open notebooks, how git is run, and
// the repository the folder is in, looked up again on every call (a `git init` later is seen at once).
import type { GitChange, GitRepo } from "@jsnb/core";
import { GitFailed } from "@jsnb/core";

import type { Session } from "../session/session.js";
import { textOf } from "../session/fileForm.js";
import type { Notebooks } from "../workspace/notebooks.js";
import type { Side } from "./content.js";
import { blob, worktree } from "./content.js";
import type { GitOptions, GitRun } from "./exec.js";
import { git } from "./exec.js";
import type { RepoLocation } from "./status.js";

export type GitContext = {
  readonly root: string;
  readonly notebooks: Notebooks;
  /** How git is run (the PATH it is found on). */
  readonly options: GitOptions;
  readonly run: (cwd: string, args: readonly string[], extra?: GitOptions) => Promise<GitRun>;
  /** The repository, or undefined when the folder is in none or git is missing. */
  readonly location: () => Promise<RepoLocation | undefined>;
};

const noRepository = (): GitFailed =>
  new GitFailed({
    command: "repository",
    code: null,
    message: "the workspace folder is not in a git repository, or git is not installed",
  });

/** The repository, or GitFailed for a write or a diff where there is none. */
export async function required(context: GitContext): Promise<RepoLocation> {
  const found = await context.location();
  if (found === undefined) throw noRepository();
  return found;
}

/** A runner of git with the context's options under each call's own. */
export const runnerOf =
  (options: GitOptions) =>
  (cwd: string, args: readonly string[], extra: GitOptions = {}): Promise<GitRun> =>
    git(cwd, args, { ...options, ...extra });

/** The session of `path` when it is an open notebook. */
export async function sessionOf(context: GitContext, path: string): Promise<Session | undefined> {
  if (!context.notebooks.openRefs().includes(path)) return undefined;
  return context.notebooks.require(path).catch(() => undefined);
}

/** The working tree's side of `path`: an open notebook's state as its file would hold it, else the file. */
export async function workingSide(context: GitContext, path: string): Promise<Side> {
  const session = await sessionOf(context, path);
  if (session === undefined) return worktree(context.root, path);
  const { header, cells } = session.context;
  return { kind: "bytes", bytes: Buffer.from(textOf(header, cells.list())) };
}

/** The status with each tracked open notebook whose unsaved state differs from its file added as modified, since
 * git.diff compares that state (§2.4): `nimbo diff --stat` and the view list what the diff of the file shows. */
export async function withOpenEdits(
  context: GitContext,
  found: RepoLocation,
  repo: GitRepo,
): Promise<GitRepo> {
  const listed = new Set([...repo.changes, ...repo.conflicts].map((change) => change.path));
  const added: GitChange[] = [];
  for (const path of context.notebooks.openRefs()) {
    if (listed.has(path)) continue;
    const session = await sessionOf(context, path);
    if (session?.context.autosave.state().dirty !== true) continue;
    const live = await workingSide(context, path);
    const disk = await worktree(context.root, path);
    if (live.kind === "bytes" && disk.kind === "bytes" && live.bytes.equals(disk.bytes)) continue;
    const tracked = await blob(found.top, `:0:${found.prefix}${path}`);
    if (tracked.kind !== "none") added.push({ path, status: "modified", notebook: true });
  }
  if (added.length === 0) return repo;
  const changes = [...repo.changes, ...added].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  return { ...repo, changes };
}

/** Writes the open notebooks among `paths` (every open one with "all") that hold unsaved edits. */
export async function saveOpen(
  context: GitContext,
  paths: readonly string[] | "all",
): Promise<void> {
  const open = context.notebooks.openRefs();
  const refs = paths === "all" ? open : paths.filter((path) => open.includes(path));
  for (const ref of refs) {
    const session = await sessionOf(context, ref);
    if (session?.context.autosave.state().dirty === true) await session.save(false);
  }
}
