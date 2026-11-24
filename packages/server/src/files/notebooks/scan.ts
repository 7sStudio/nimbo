// The notebooks of a workspace (03-api §4.1 `workspace.info`, 07-file-format §7: anywhere under the workspace) and the
// `<name>.jsnb.tmp-<pid>-<random>` files a crashed save left beside them (07-file-format §9), found by one bounded walk that skips node_modules and hidden folders and follows no symbolic
// link. A symbolic link at such a name (a cloned workspace may carry one) is a leftover too, removed itself, never
// followed.
import type { Dirent } from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/** How deep and how wide the walk goes: a workspace is a project folder, not a home directory. */
const maxDepth = 8;
const maxEntries = 20_000;

const temp = /\.jsnb\.tmp-\d+(?:-[0-9a-f]+)?$/;

export type ScanResult = {
  /** Notebook refs, relative with `/`, sorted. */
  readonly notebooks: readonly string[];
  /** Absolute paths of leftover temp files. */
  readonly leftovers: readonly string[];
};

const skipped = (entry: Dirent): boolean =>
  entry.name === "node_modules" || entry.name.startsWith(".");

type Walk = { readonly root: string; seen: number; notebooks: string[]; leftovers: string[] };

/** Notes `entry` (in `dir`): a notebook, or a leftover temp file or a link at a temp file's name. */
function note(walk: Walk, dir: string, entry: Dirent): void {
  const path = join(dir, entry.name);
  if (entry.isFile() && entry.name.endsWith(".jsnb"))
    walk.notebooks.push(relative(walk.root, path).split(sep).join("/"));
  else if ((entry.isFile() || entry.isSymbolicLink()) && temp.test(entry.name))
    walk.leftovers.push(path); // a link itself, never what it points to
}

async function visit(walk: Walk, dir: string, depth: number): Promise<void> {
  if (depth > maxDepth || walk.seen > maxEntries) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []); // unreadable folders are skipped
  for (const entry of entries) {
    walk.seen += 1;
    if (entry.isDirectory() && !skipped(entry)) await visit(walk, join(dir, entry.name), depth + 1);
    note(walk, dir, entry);
  }
}

/** Walks `root` for notebooks and leftover temp files. */
export async function scanWorkspace(root: string): Promise<ScanResult> {
  const walk: Walk = { root, seen: 0, notebooks: [], leftovers: [] };
  await visit(walk, root, 0);
  return { notebooks: walk.notebooks.sort(), leftovers: walk.leftovers };
}

/** Deletes the temp files a crashed save left (a daemon starting now owns none of them), a link as itself. */
export async function removeLeftovers(root: string): Promise<readonly string[]> {
  const { leftovers } = await scanWorkspace(root);
  await Promise.all(
    leftovers.map((path) =>
      unlink(path).catch((error: unknown) => {
        if (!(error instanceof Error && Reflect.get(error, "code") === "ENOENT")) throw error;
      }),
    ),
  );
  return leftovers;
}
