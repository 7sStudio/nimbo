// The folder listing behind Home's Open folder (workspace.listFolders): a path from the page
// read as a folder of this computer and the folders in it, read only. The path is normalised before use (`~` is the
// home folder, a relative path is taken from the workspace folder, `..` resolved) and its links resolved; anything that
// is not a readable folder is refused in words. A listing names folders only: of the files it counts the `.jsnb` ones
// a folder holds directly, and never says a file's name or reads one. Hidden folders are left out unless the path
// names one. Nothing here writes.
import type { Dirent } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import type { FolderReason } from "./errors.js";
import { FolderRefused } from "./errors.js";

/** How many folders a listing names; the rest are counted. */
const listed = 500;
/** How many of them get their notebooks counted (one read of each folder). */
const counted = 200;
/** How many folders are read at once while counting. */
const together = 16;

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

const reasonOf = (error: unknown): FolderReason => {
  const code = codeOf(error);
  if (code === "ENOENT") return "missing";
  if (code === "ENOTDIR") return "notFolder";
  if (code === "ELOOP") return "loop";
  if (code === "EACCES" || code === "EPERM") return "unreadable";
  if (code === "ERR_INVALID_ARG_VALUE" || code === "ENAMETOOLONG") return "notPath";
  throw error;
};

/** `path` as an absolute, normalised path: `~` the home folder, a relative path from `base`. */
function absoluteOf(path: string, base: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith(`~${sep}`) || trimmed.startsWith("~/"))
    return join(homedir(), trimmed.slice(2));
  return resolve(base, trimmed);
}

/** The real path of the readable folder `path` names (read from `base`), or FolderRefused in words. */
export async function folderAt(path: string, base: string): Promise<string> {
  const absolute = absoluteOf(path, base);
  try {
    const real = await realpath(absolute);
    if (!(await stat(real)).isDirectory())
      throw new FolderRefused({ path: absolute, reason: "notFolder" });
    await readdir(real); // a folder that refuses to be read is refused here, before anyone acts on it
    return real;
  } catch (error) {
    if (error instanceof FolderRefused) throw error;
    throw new FolderRefused({ path: absolute, reason: reasonOf(error) });
  }
}

/** Whether `name` in `folder` is a folder (a link followed), without failing on what cannot be read. */
async function isFolder(folder: string, entry: Dirent): Promise<boolean> {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  return stat(join(folder, entry.name)).then(
    (found) => found.isDirectory(),
    () => false,
  );
}

const isNotebook = (entry: Dirent): boolean =>
  (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".jsnb");

/** How many notebooks `folder` holds directly; null when it cannot be read. */
async function notebooksIn(folder: string): Promise<number | null> {
  try {
    return (await readdir(folder, { withFileTypes: true })).filter(isNotebook).length;
  } catch {
    // Unreadable (permissions, a folder removed meanwhile): its count is not known, and the row still shows.
    return null;
  }
}

/** The nearest folder holding a `.jsnb/` folder, `folder` or one above it, as `nimbo open` there finds it; else none. */
export async function markedWorkspace(folder: string): Promise<string | undefined> {
  for (let at = folder; ; at = dirname(at)) {
    const marked = await stat(join(at, ".jsnb")).then(
      (found) => found.isDirectory(),
      () => false,
    );
    if (marked) return at;
    if (dirname(at) === at) return undefined;
  }
}

/** Runs `work` over `items`, `together` at a time, in order. */
async function inBatches<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let at = 0; at < items.length; at += together)
    out.push(...(await Promise.all(items.slice(at, at + together).map(work))));
  return out;
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export type FolderListing = {
  readonly path: string;
  readonly parent: string | null;
  readonly workspace: string;
  readonly current: boolean;
  readonly notebooks: number;
  readonly folders: readonly {
    readonly name: string;
    readonly path: string;
    readonly notebooks: number | null;
  }[];
  readonly more: number;
};

/** The listing of the folder `path` names (from `root`, the workspace folder), which `root`'s daemon serves. */
export async function listFolders(path: string | undefined, root: string): Promise<FolderListing> {
  const folder = await folderAt(path ?? root, root);
  let entries: Dirent[];
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch (error) {
    throw new FolderRefused({ path: folder, reason: reasonOf(error) });
  }
  const visible = entries.filter((entry) => !entry.name.startsWith("."));
  const kinds = await inBatches(visible, (entry) => isFolder(folder, entry));
  const names = visible
    .filter((_, at) => kinds[at] === true)
    .map((entry) => entry.name)
    .sort(collator.compare);
  const shown = names.slice(0, listed);
  const counts = await inBatches(shown.slice(0, counted), (name) =>
    notebooksIn(join(folder, name)),
  );
  const workspace = (await markedWorkspace(folder)) ?? folder;
  return {
    path: folder,
    parent: dirname(folder) === folder ? null : dirname(folder),
    workspace,
    current: workspace === root,
    notebooks: entries.filter(isNotebook).length,
    folders: shown.map((name, at) => ({
      name,
      path: join(folder, name),
      notebooks: counts[at] ?? null,
    })),
    more: names.length - shown.length,
  };
}
