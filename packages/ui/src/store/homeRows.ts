// The Home page's list in its order: the notebooks grouped by folder (the workspace root first,
// then each folder by name), the rows in the order ↑ ↓ move through them (a collapsed folder's rows left out), and the
// path a new notebook's form names. Pure: the commands and the views read it alike.
import type { NotebookEntry } from "@jsnb/core";

export type FolderGroup = {
  /** The folder's ref, "" for the workspace root. */
  readonly folder: string;
  readonly label: string;
  readonly notebooks: readonly NotebookEntry[];
};

/** The folder part of `path` ("" at the root) and its file name. */
export function splitPath(path: string): { readonly folder: string; readonly name: string } {
  const at = path.lastIndexOf("/");
  return at === -1
    ? { folder: "", name: path }
    : { folder: path.slice(0, at), name: path.slice(at + 1) };
}

export const folderLabel = (folder: string): string => (folder === "" ? "Workspace root" : folder);

// One collator for every sort of the list, made when the module loads: the names in the reader's own order.
const collator = new Intl.Collator();

/** The notebooks in their folders, the root first and the others by name, each folder's notebooks by name. */
export function groupsOf(notebooks: readonly NotebookEntry[]): readonly FolderGroup[] {
  const byFolder = new Map<string, NotebookEntry[]>();
  for (const notebook of notebooks) {
    const { folder } = splitPath(notebook.path);
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), notebook]);
  }
  return [...byFolder.keys()]
    .sort((a, b) => (a === "" ? -1 : b === "" ? 1 : collator.compare(a, b)))
    .map((folder) => ({
      folder,
      label: folderLabel(folder),
      notebooks: (byFolder.get(folder) ?? []).sort((a, b) => collator.compare(a.path, b.path)),
    }));
}

/** The refs in the order ↑ and ↓ move through them. */
export const rowOrder = (groups: readonly FolderGroup[]): readonly string[] =>
  groups.flatMap((group) => group.notebooks.map((notebook) => notebook.path));

/** The ref `step` rows from `current` in `order` (the first or last when none is selected), clamped at the ends. */
export function stepFrom(order: readonly string[], current: string | null, step: 1 | -1) {
  if (order.length === 0) return null;
  const at = current === null ? -1 : order.indexOf(current);
  if (at === -1) return step === 1 ? (order[0] ?? null) : (order.at(-1) ?? null);
  return order[Math.min(order.length - 1, Math.max(0, at + step))] ?? null;
}

/** The path a new notebook's form names: its name (`.jsnb` added when missing) in its folder. */
export function newPath(name: string, folder: string): string {
  const trimmed = name.trim().replace(/^\/+|\/+$/gu, "");
  const file = trimmed.endsWith(".jsnb") ? trimmed : `${trimmed}.jsnb`;
  const where = folder.trim().replace(/^\/+|\/+$/gu, "");
  return where === "" ? file : `${where}/${file}`;
}
