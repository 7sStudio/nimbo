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
