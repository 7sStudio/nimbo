// The path and revision rules of the Source Control commands: a path is relative to the
// workspace folder, inside it (no `..`, no absolute path, no leading `-`), and no symbolic link on its folders leads out
// of it; a revision is a plain name git resolves to a commit. Every path reaches git after `--`.
import { lstat, realpath } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import { InvalidParams } from "@jsnb/core";

import { git } from "./exec.js";

const refused = (field: string, value: string, why: string): InvalidParams =>
  new InvalidParams({ issues: [{ path: [field], message: `${value}: ${why}` }] });

const isInside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/u.test(rel));
};

/** The nearest existing folder at or above `dir`, through its links. */
async function existingFolder(dir: string): Promise<string> {
  try {
    return await realpath(dir);
  } catch {
    return dirname(dir) === dir ? dir : existingFolder(dirname(dir));
  }
}

// Code points HFS+ and APFS ignore in names (git's is_hfs_dotgit), so `.g\u200cit` is `.git` on a Mac.
const ignorable = /[\u200b-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/gu;

/** Whether a path segment names a git directory on some file system: `.git` in any case, with ignorable code points,
 * trailing dots or spaces (NTFS), or its 8.3 short name `git~1`. */
function isGitDir(segment: string): boolean {
  const plain = segment
    .normalize("NFC")
    .replace(ignorable, "")
    .toLowerCase()
    .replace(/[. ]+$/u, "");
  return plain === ".git" || plain === "git~1";
}

const intoGitDir = (root: string, path: string): boolean =>
  relative(root, path)
    .split(sep)
    .some((part) => isGitDir(part));

/** The file itself when it is a symbolic link: where it points, resolved. */
async function linkTarget(file: string): Promise<string | undefined> {
  const stats = await lstat(file).catch(() => undefined);
  if (stats?.isSymbolicLink() !== true) return undefined;
  return realpath(file).catch(() => undefined);
}

/** Checks one workspace path; answers it in git's form (`/` separators). A name starting with `-` is a file's: git
 * gets every path after `--`. */
export async function checkPath(root: string, path: string, field = "path"): Promise<string> {
  if (path.includes("\0")) throw refused(field, path, "a path cannot hold a NUL byte");
  const posix = path.split("\\").join("/");
  if (posix.startsWith("/") || /^[A-Za-z]:/u.test(posix))
    throw refused(field, path, "use a path relative to the workspace folder");
  const parts = posix.split("/");
  if (parts.some((part) => part === ".."))
    throw refused(field, path, "a path cannot leave the workspace folder");
  const clean = parts.filter((part) => part !== "" && part !== ".").join("/");
  if (clean === "") throw refused(field, path, "name a file");
  if (clean.split("/").some((part) => isGitDir(part)))
    throw refused(field, path, "a path cannot be inside the .git folder");
  await checkLinks(root, clean, (why) => refused(field, path, why));
  return clean;
}

/** No symbolic link on the path's folders leads out of the workspace or into a .git folder, nor the file itself
 * into one. */
async function checkLinks(
  root: string,
  clean: string,
  refuse: (why: string) => InvalidParams,
): Promise<void> {
  const realRoot = await realpath(root);
  const file = join(root, ...clean.split("/"));
  const folder = await existingFolder(dirname(file));
  if (!isInside(realRoot, folder) || intoGitDir(realRoot, folder))
    throw refuse("a symbolic link takes it outside the workspace folder");
  const target = await linkTarget(file);
  if (target !== undefined && intoGitDir(realRoot, target))
    throw refuse("a symbolic link takes it into the .git folder");
}

const revisionPattern = /^[A-Za-z0-9][A-Za-z0-9._/@~^-]*$/u;

/** Checks a revision and answers the commit it names; InvalidParams when it names none. */
export async function checkRevision(
  root: string,
  revision: string,
  field = "base",
): Promise<string> {
  if (!revisionPattern.test(revision) || revision.includes(".."))
    throw refused(field, revision, "not a revision name");
  const run = await git(
    root,
    ["rev-parse", "--verify", "--quiet", "--end-of-options", `${revision}^{commit}`],
    {
      read: true,
      allowFailure: true,
    },
  );
  if (run.code !== 0) throw refused(field, revision, "no such commit in this repository");
  return run.stdout.toString("utf8").trim();
}

// eslint-disable-next-line no-control-regex -- the control characters are what this refuses
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

/** A branch name git accepts (`git check-ref-format --branch`), never an option, with no control character. */
export async function checkBranchName(root: string, name: string, field = "name"): Promise<string> {
  if (name.startsWith("-")) throw refused(field, name, "a branch name cannot start with -");
  if (name.includes("@{")) throw refused(field, name, "a branch name cannot hold @{");
  if (controls.test(name) || /\s/u.test(name))
    throw refused(field, name, "a branch name cannot hold spaces or control characters");
  const run = await git(root, ["check-ref-format", "--branch", name], {
    read: true,
    allowFailure: true,
  });
  if (run.code !== 0 || name === "HEAD") throw refused(field, name, "not a valid branch name");
  return name;
}

const remotePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/** A remote's name, one of the repository's remotes. */
export function checkRemote(name: string, remotes: readonly string[], field = "remote"): string {
  if (!remotePattern.test(name)) throw refused(field, name, "not a remote name");
  if (!remotes.includes(name)) throw refused(field, name, "no such remote in this repository");
  return name;
}

/** A commit or stash message: any text but control characters other than tab and line ends. */
export function checkMessage(message: string, field = "message"): string {
  if (controls.test(message))
    throw refused(field, message.slice(0, 40), "a message cannot hold control characters");
  return message;
}
