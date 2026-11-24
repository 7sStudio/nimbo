// Home's search: what the field's words find among the workspace's notebooks, best first. A notebook
// matches when every word is in its file name, its path, its title, one of its routes or one of its exports (the last
// three from notebook.summary, once read); a word in the name ranks first (at its start before inside it), then the
// folder, the title, a route and an export. Pure: the list, the keys and the tests read it alike.
import type { NotebookEntry, NotebookSummary } from "@jsnb/core";

import { splitPath } from "./homeRows.js";

/** A notebook the words found, with where the first word sits in its name (null when it is elsewhere). */
export type SearchMatch = {
  readonly path: string;
  readonly mark: { readonly from: number; readonly to: number } | null;
};

export type SearchResult = {
  /** The notebooks every word found, best first. */
  readonly matches: readonly SearchMatch[];
  /** The others, in list order. */
  readonly rest: readonly string[];
};

/** The words of `query`, lower case; none for a query of spaces. */
export const wordsOf = (query: string): readonly string[] =>
  query
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== "");

const stem = (name: string): string => name.replace(/\.jsnb$/u, "");

/** How well `word` fits the notebook, 0 best; undefined when it is nowhere. */
function fit(word: string, path: string, summary: NotebookSummary | undefined): number | undefined {
  const name = stem(splitPath(path).name).toLowerCase();
  const places = [
    name.startsWith(word),
    name.includes(word),
    path.toLowerCase().includes(word),
    summary?.title.toLowerCase().includes(word) === true,
    summary?.routes.some((route) => route.toLowerCase().includes(word)) === true,
    summary?.exports.some((name) => name.toLowerCase().includes(word)) === true,
  ];
  const at = places.indexOf(true);
  return at === -1 ? undefined : at;
}

const collator = new Intl.Collator();

/** The notebooks of `entries` (in list order) that `query` finds, best first, and the rest. */
export function searchNotebooks(
  entries: readonly NotebookEntry[],
  summaries: ReadonlyMap<string, NotebookSummary | undefined>,
  query: string,
): SearchResult {
  const words = wordsOf(query);
  if (words.length === 0) return { matches: [], rest: entries.map((each) => each.path) };
  const scored = entries.flatMap(({ path }) => {
    const fits = words.map((word) => fit(word, path, summaries.get(path)));
    if (fits.some((each) => each === undefined)) return [];
    return [{ path, score: fits.reduce<number>((sum, each) => sum + (each ?? 0), 0) }];
  });
  scored.sort((a, b) => a.score - b.score || collator.compare(a.path, b.path));
  const found = new Set(scored.map((each) => each.path));
  const first = words[0] ?? "";
  return {
    matches: scored.map(({ path }) => {
      const from = stem(splitPath(path).name).toLowerCase().indexOf(first);
      return { path, mark: from === -1 ? null : { from, to: from + first.length } };
    }),
    rest: entries.map((each) => each.path).filter((path) => !found.has(path)),
  };
}
