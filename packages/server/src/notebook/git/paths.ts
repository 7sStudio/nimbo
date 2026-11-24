// The path and revision rules of the Source Control commands: a path is relative to the
// workspace folder, inside it (no `..`, no absolute path, no leading `-`), and no symbolic link on its folders leads out
// of it; a revision is a plain name git resolves to a commit. Every path reaches git after `--`.
import { realpath } from "node:fs/promises";
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

/** Checks one workspace path; answers it in git's form (`/` separators). */
export async function checkPath(root: string, path: string, field = "path"): Promise<string> {
  if (path.includes("\0")) throw refused(field, path, "a path cannot hold a NUL byte");
  const posix = path.split("\\").join("/");
  if (posix.startsWith("/") || /^[A-Za-z]:/u.test(posix))
    throw refused(field, path, "use a path relative to the workspace folder");
  if (posix.startsWith("-")) throw refused(field, path, "a path cannot start with -");
  const parts = posix.split("/");
  if (parts.some((part) => part === ".."))
    throw refused(field, path, "a path cannot leave the workspace folder");
  const clean = parts.filter((part) => part !== "" && part !== ".").join("/");
  if (clean === "") throw refused(field, path, "name a file");
  const folder = await existingFolder(dirname(join(root, ...clean.split("/"))));
  if (!isInside(await realpath(root), folder))
    throw refused(field, path, "a symbolic link takes it outside the workspace folder");
  return clean;
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
