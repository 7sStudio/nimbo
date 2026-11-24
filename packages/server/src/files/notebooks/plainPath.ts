// The paths notebook.delete and notebook.rename act on (03-api §4.2): notebook.create's rules (notebookPath: a
// notebook ref inside the workspace, the file system's refusals named), and then no symbolic link anywhere on the
// path, the file itself included. Opening through a link stays allowed; deleting or moving through one
// would act on a file the ref does not name, so it is refused at either end.
import type { Stats } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";

import { InvalidParams, NotebookExists, NotebookNotFound } from "@jsnb/core";

import { notebookPath } from "./notebookFile.js";

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

const throughLink = (ref: string, field: string, part: string): InvalidParams =>
  new InvalidParams({
    issues: [
      {
        path: [field],
        message: `${ref} goes through the symbolic link ${part}; notebooks are deleted and renamed by their own path only`,
      },
    ],
  });

/** What is at each existing part of `ref` under `root`, in order; the walk stops at the first part that is missing. */
async function partsOf(root: string, ref: string): Promise<readonly (readonly [string, Stats])[]> {
  const segments = ref.split("/");
  const found: (readonly [string, Stats])[] = [];
  for (let index = 1; index <= segments.length; index += 1) {
    const part = segments.slice(0, index).join("/");
    const stats = await lstat(join(root, part)).catch((error: unknown) => {
      if (codeOf(error) === "ENOENT") return undefined;
      throw error;
    });
    if (stats === undefined) break;
    found.push([part, stats]);
  }
  return found;
}

/** Refuses the first part of `ref` that is a symbolic link. */
function refuseLinks(
  parts: readonly (readonly [string, Stats])[],
  ref: string,
  field: string,
): void {
  const link = parts.find(([, stats]) => stats.isSymbolicLink());
  if (link) throw throughLink(ref, field, link[0]);
}

/** The file of an existing notebook `ref`, reached through no link; NotebookNotFound when no file is there. */
export async function plainNotebookFile(root: string, ref: string, field: string): Promise<string> {
  const path = await notebookPath(root, ref, field);
  const parts = await partsOf(root, ref);
  refuseLinks(parts, ref, field);
  const last = parts.at(-1);
  if (parts.length !== ref.split("/").length || last?.[1].isFile() !== true) {
    throw new NotebookNotFound({ path: ref });
  }
  return path;
}

/**
 * The free path `to` (a notebook ref) a rename moves a notebook to, reached through no link; NotebookExists when
 * something is there, unless it is `from` itself under a name that differs only in case (a rename that changes only
 * the case on a case-insensitive disk). A hard link of `from` at `to` is another name of the file: NotebookExists.
 */
export async function freeNotebookPath(
  root: string,
  to: string,
  from: { readonly ref: string; readonly stats: Stats },
): Promise<{ readonly path: string; readonly sameFile: boolean }> {
  const path = await notebookPath(root, to, "to");
  const parts = await partsOf(root, to);
  refuseLinks(parts, to, "to");
  if (parts.length < to.split("/").length) return { path, sameFile: false };
  const there = parts.at(-1)?.[1];
  const caseOnly = to !== from.ref && to.toLowerCase() === from.ref.toLowerCase();
  const sameFile = caseOnly && there?.dev === from.stats.dev && there.ino === from.stats.ino;
  if (!sameFile) throw new NotebookExists({ path: to });
  return { path, sameFile };
}
