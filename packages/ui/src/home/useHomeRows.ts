// The Home list's rows as the views show them: what homeList orders, read into one line per notebook
// (its name, marked where the typed word sits, its folder, its kernel in words while open, its cells, routes and edit
// time), every notebook with nothing typed and the matches with words. Derived with computed, never stored.
import type { NotebookEntry } from "@jsnb/core";
import type { ComputedRef, Ref } from "vue";
import { computed, watchEffect } from "vue";

import { useHomeStore } from "../store/home.js";
import { newPath, splitPath } from "../store/homeRows.js";
import type { SearchMatch } from "../store/homeSearch.js";
import type { HomeList } from "../store/homeView.js";
import { homeList } from "../store/homeView.js";
import type { RowModel } from "./rows.js";
import { kernelTone, kernelWords, relativeTime, sizeText } from "./rows.js";

const partsOf = (stem: string, mark: SearchMatch["mark"]): RowModel["parts"] =>
  mark === null
    ? [stem, "", ""]
    : [stem.slice(0, mark.from), stem.slice(mark.from, mark.to), stem.slice(mark.to)];

type Home = ReturnType<typeof useHomeStore>;
type List = ComputedRef<HomeList>;

/** Side effect: no row is selected until the user picks one (a click, Up or Down), as in VS Code's Explorer; while
 * searching, the best match is, so Enter opens it. A selected row that went away (deleted, renamed, folded, filtered
 * out) leaves nothing selected. */
function keepSelection(home: Home, list: List): void {
  watchEffect(() => {
    const view = list.value;
    if (home.selected !== null && view.order.includes(home.selected)) return;
    home.selected = view.searching ? (view.matches[0]?.path ?? null) : null;
  });
}

/** One row's columns, as the list shows them. */
const rowMaker =
  (home: Home, list: List, now: Ref<number>) =>
  (entry: NotebookEntry, mark: SearchMatch["mark"] = null): RowModel => {
    const { folder, name } = splitPath(entry.path);
    const summary = home.summaries.get(entry.path);
    const kernel = home.kernels[entry.path];
    return {
      path: entry.path,
      folder,
      parts: partsOf(name, mark),
      kernel: kernelWords(entry.open, kernel, now.value),
      tone: kernelTone(entry.open, kernel),
      cells: summary === undefined ? "" : String(summary.cells.length),
      routes: summary?.routes.join(", ") ?? "",
      edited: relativeTime(entry.modifiedAt, now.value),
      file: [entry.modifiedAt ?? "", sizeText(entry.bytes)].filter(Boolean).join(", "),
      open: entry.open,
    };
  };

type Found = readonly { readonly path: string; readonly mark: SearchMatch["mark"] }[];

/** The rows of the notebooks `found` names, each once listed. */
function rowLister(home: Home, rowOf: ReturnType<typeof rowMaker>) {
  const byPath = computed(() => new Map(home.notebooks.map((each) => [each.path, each])));
  return (found: Found) =>
    found.flatMap(({ path, mark }) => {
      const entry = byPath.value.get(path);
      return entry === undefined ? [] : [rowOf(entry, mark)];
    });
}

export function useHomeRows(now: Ref<number>) {
  const home = useHomeStore();
  const list = computed(() =>
    homeList({
      notebooks: home.notebooks,
      summaries: home.summaries,
      query: home.query,
      folder: home.folder,
    }),
  );
  keepSelection(home, list);
  const typed = computed(() => home.query.trim());
  const rowsOf = rowLister(home, rowMaker(home, list, now));

  return {
    list,
    typed,
    /** A workspace with no notebook and nothing typed: the empty state stands where the list would. */
    empty: computed(() => home.loaded && home.notebooks.length === 0 && typed.value === ""),
    /** The path Cmd Enter creates: what is typed, in the folder picked. */
    created: computed(() => (typed.value === "" ? "" : newPath(typed.value, home.folder))),
    rowId: (path: string) => `home-row-${String(list.value.order.indexOf(path))}`,
    /** The rows shown: the matches while searching, else every notebook of the folder picked. */
    rows: computed(() =>
      list.value.searching
        ? rowsOf(list.value.matches)
        : rowsOf(list.value.order.map((path) => ({ path, mark: null }))),
    ),
  };
}
