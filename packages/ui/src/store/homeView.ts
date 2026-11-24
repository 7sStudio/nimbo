// What Home's list shows and in which order the keys move through it: the notebooks of the folder the
// Workspace panel picked; with no words in the search field, grouped by folder (a folded folder's rows left out), and
// with words, the matches best first, then everything else. And the folders the Workspace panel lists. Pure: the
// views and the commands read it alike.
import type { NotebookEntry, NotebookSummary } from "@jsnb/core";

import type { FolderGroup } from "./homeRows.js";
import { groupsOf, rowOrder, splitPath } from "./homeRows.js";
import type { SearchResult } from "./homeSearch.js";
import { searchNotebooks, wordsOf } from "./homeSearch.js";

export type HomeListInput = {
  readonly notebooks: readonly NotebookEntry[];
  readonly summaries: ReadonlyMap<string, NotebookSummary | undefined>;
  readonly query: string;
  /** The folder the Workspace panel picked, "" for every notebook. */
  readonly folder: string;
};

export type HomeList =
  | {
      readonly searching: false;
      readonly groups: readonly FolderGroup[];
      readonly order: readonly string[];
    }
  | ({ readonly searching: true; readonly order: readonly string[] } & SearchResult);

/** Whether `path` is in `folder` or below it; every path is in "". */
const inFolder = (path: string, folder: string): boolean =>
  folder === "" || path.startsWith(`${folder}/`);

/** The list as it shows, and the refs in the order Up and Down move through them. */
export function homeList(input: HomeListInput): HomeList {
  const notebooks = input.notebooks.filter((each) => inFolder(each.path, input.folder));
  if (wordsOf(input.query).length === 0) {
    const groups = groupsOf(notebooks);
    return { searching: false, groups, order: rowOrder(groups) };
  }
  const ordered = groupsOf(notebooks).flatMap((group) => group.notebooks);
  const found = searchNotebooks(ordered, input.summaries, input.query);
  // while searching only the matches show, so only they take the selection
  return { searching: true, ...found, order: found.matches.map((m) => m.path) };
}

/** The refs in the order the list shows them and Up and Down move through them. */
export const shownOrder = (input: HomeListInput): readonly string[] => homeList(input).order;

/** A folder of the Workspace panel: its ref, its depth below the root and how many notebooks are in it or below. */
export type FolderRow = { readonly folder: string; readonly depth: number; readonly count: number };

const collator = new Intl.Collator();

/** Folders as a tree reads them: segment by segment, so a folder is followed by its own subfolders. */
function byFolder(a: string, b: string): number {
  const [left, right] = [a.split("/"), b.split("/")];
  for (let at = 0; at < Math.min(left.length, right.length); at += 1) {
    const order = collator.compare(left[at] ?? "", right[at] ?? "");
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

/** Every folder that holds a notebook, with the folders above it, as a tree reads them. */
export function folderRows(notebooks: readonly NotebookEntry[]): readonly FolderRow[] {
  const folders = new Set<string>();
  for (const { path } of notebooks) {
    const parts = splitPath(path)
      .folder.split("/")
      .filter((part) => part !== "");
    parts.forEach((_, at) => folders.add(parts.slice(0, at + 1).join("/")));
  }
  return [...folders].sort(byFolder).map((folder) => ({
    folder,
    depth: folder.split("/").length - 1,
    count: notebooks.filter((each) => inFolder(each.path, folder)).length,
  }));
}
