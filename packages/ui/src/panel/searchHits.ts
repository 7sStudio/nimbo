// The Search view's matches (the left icon bar): a text found in the notebook's cells, grouped by
// cell with each matching line, and in the workspace's notebook file names, which the page already lists. Case does not
// count unless asked; a cell's unsent draft is searched, as it is what the editor shows.

/** One matching line: its 1-based number, its text and where the first match on it starts and ends (0-based). */
export type LineHit = {
  readonly line: number;
  readonly text: string;
  readonly from: number;
  readonly to: number;
};

/** A cell with matches: its id, its number, its type and name, and its matching lines (at most `perCell`). */
export type CellHits = {
  readonly cell: string;
  readonly number: number;
  readonly type: "server" | "client" | "markdown";
  readonly name: string;
  readonly lines: readonly LineHit[];
  /** How many matching lines it has, shown or not. */
  readonly total: number;
};

export type Searched = {
  readonly id: string;
  readonly type: "server" | "client" | "markdown";
  readonly name: string;
  readonly text: string;
};

/** The most lines shown for one cell; the rest are counted. */
export const perCell = 20;

/** The lines of `text` that hold `needle`, each with its first match. */
export function linesWith(text: string, needle: string, matchCase = false): readonly LineHit[] {
  if (needle === "") return [];
  const wanted = matchCase ? needle : needle.toLowerCase();
  return text.split("\n").flatMap((line, at) => {
    const from = (matchCase ? line : line.toLowerCase()).indexOf(wanted);
    return from < 0 ? [] : [{ line: at + 1, text: line, from, to: from + needle.length }];
  });
}

/** The cells that hold `needle`, in order, each with its matching lines. */
export function cellHits(
  cells: readonly Searched[],
  needle: string,
  matchCase = false,
): readonly CellHits[] {
  return cells.flatMap((cell, at) => {
    const lines = linesWith(cell.text, needle.trim() === "" ? "" : needle, matchCase);
    return lines.length === 0
      ? []
      : [
          {
            cell: cell.id,
            number: at + 1,
            type: cell.type,
            name: cell.name,
            lines: lines.slice(0, perCell),
            total: lines.length,
          },
        ];
  });
}

/** The workspace's notebook paths whose name holds `needle`, case aside. */
export function fileHits(paths: readonly string[], needle: string): readonly string[] {
  const wanted = needle.trim().toLowerCase();
  return wanted === "" ? [] : paths.filter((path) => path.toLowerCase().includes(wanted));
}
