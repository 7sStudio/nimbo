// notebook.summary's reading of a notebook (03-api §4.2): the title and intro of its first markdown
// cell, each cell with its name, its size and a peek at its first lines, the routes, exports, packages and env names
// its code declares, each cell's last edit, and an open notebook's last result. Pure: the daemon gives each code
// cell's analysis (transform's, the graph's), the package names of its imports (Node's resolution rule) and which of
// them the workspace lacks, and an open session's last runs; nothing here runs a cell.
import type { CellType, FileEditInfo } from "../model/cell.js";
import type { CellSummary, EditSummary, LastResult, NotebookSummary } from "../model/summary.js";
import { cellName, firstLine, routesIn } from "./cellName.js";
import type { NameFacts } from "./cellName.js";
import { changedLines } from "./lineDiff.js";

/** One cell as the summary reads it: its type, text and last edit, and what its analysis found (none for markdown). */
export type SummaryCell = {
  readonly type: CellType;
  readonly source: string;
  readonly lastEdit: FileEditInfo | undefined;
  readonly facts: NameFacts | undefined;
  /** The title the user gave the cell (meta.title), if any. */
  readonly title?: string | undefined;
};

const textLimit = 280;
const introLimit = 600;
/** The longest line a peek or a last result keeps; the page cuts it again to its width. */
const lineLimit = 200;
const peekLines = 4;

/** Inline markdown read as plain text: links to their words, emphasis and code marks dropped. */
const plain = (line: string): string =>
  line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/(?<![\w*])(\*\*|__|\*|_|`)(\S(?:.*?\S)?)\1(?![\w*])/gu, "$2")
    .replace(/^\s*(?:>\s*|[-*+]\s+|\d+\.\s+)/u, "")
    .trim();

const fence = /^\s*(?:```|~~~)/u;

const cut = (text: string, limit: number): string =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

/** The lines of the first paragraph after the first line with text, as written: headings and fenced code are passed
 * over, and the paragraph ends at a blank line, a heading or a fence. */
function paragraphAfterTitle(source: string): readonly string[] {
  const lines = source.split("\n");
  const rest = lines.slice(lines.findIndex((line) => line.trim() !== "") + 1);
  const taken: string[] = [];
  let fenced = false;
  for (const line of rest) {
    const breaks = line.trim() === "" || /^\s*#/u.test(line) || fence.test(line);
    if (taken.length > 0 && breaks) break;
    if (fence.test(line)) fenced = !fenced;
    else if (!fenced && !breaks) taken.push(line.trim());
  }
  return taken;
}

/** How many lines `source` holds: 0 for an empty cell, a final newline not counted as a line of its own. */
const lineCount = (source: string): number =>
  source === "" ? 0 : source.replace(/\n$/u, "").split("\n").length;

/** A peek at a cell: a code cell's first lines from its first line with text, as written (its indentation kept, its
 * end trimmed); a markdown cell's first line of prose, its inline marks removed: the line after its heading when it
 * opens with one (the heading is already its name), else its first line. */
function peekOf(type: CellType, source: string): readonly string[] {
  if (type === "markdown") {
    const lines = source.split("\n").filter((line) => line.trim() !== "" && !fence.test(line));
    const [first, second] = lines;
    const line =
      first !== undefined && /^\s*#/u.test(first) && second !== undefined ? second : first;
    return line === undefined ? [] : [cut(plain(line.replace(/^\s*#+\s*/u, "")), lineLimit)];
  }
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.trim() !== "");
  if (start < 0) return [];
  return lines.slice(start, start + peekLines).map((line) => cut(line.trimEnd(), lineLimit));
}

/** The names `source` reads through the kernel's env proxy (04-kernel §8), in order and each once. */
export function envReads(source: string): readonly string[] {
  const pattern =
    /(?<![\w$.])env\s*(?:\.\s*has\s*\(\s*(["'`])([^"'`]+)\1\s*\)|\??\.\s*([A-Za-z_$][\w$]*)|\??\.?\[\s*(["'`])([^"'`]+)\4\s*\])/gu;
  const names = [...source.matchAll(pattern)].flatMap((match) => {
    const name = match[2] ?? match[3] ?? match[5];
    return name === undefined || name === "has" ? [] : [name];
  });
  return [...new Set(names)];
}

/** A cell's last edit, with the lines an agent changed that no one reviewed yet. */
function editOf(edit: FileEditInfo | undefined, source: string): EditSummary | null {
  if (edit === undefined) return null;
  const { review, ...who } = edit;
  return {
    ...who,
    unreviewed: review !== undefined,
    lines: review === undefined ? [] : changedLines(review.previousSource, source),
  };
}

const unique = (names: readonly string[]): readonly string[] => [...new Set(names)];

/** What the daemon knows beyond the cells' text: the packages their imports name and which of them the workspace
 * lacks, and an open notebook's last result. */
export type SummaryFacts = {
  readonly packages: readonly string[];
  readonly missing?: readonly string[];
  readonly lastResult?: LastResult | null;
  /** cells.titleFromFirstLine: a cell with no title of its own is named by its first line. */
  readonly firstLine?: boolean;
};

/** The summary of the notebook `path` from its cells, in notebook order, and what the daemon knows of them. */
export function summarize(
  path: string,
  cells: readonly SummaryCell[],
  facts: SummaryFacts,
): NotebookSummary {
  const code = cells.filter((cell) => cell.type !== "markdown");
  const at = cells.findIndex((cell) => cell.type === "markdown");
  const prose = cells[at];
  const summaries = cells.map((cell): CellSummary => ({
    type: cell.type,
    name: cellName({ ...cell, meta: { title: cell.title } }, cell.facts, [], {
      firstLine: facts.firstLine === true,
    }),
    line: firstLine(cell.source),
    lines: lineCount(cell.source),
    peek: peekOf(cell.type, cell.source),
    lastEdit: editOf(cell.lastEdit, cell.source),
  }));
  const paragraph = prose === undefined ? [] : paragraphAfterTitle(prose.source);
  return {
    path,
    title: prose === undefined ? "" : plain(firstLine(prose.source).replace(/^#+\s*/u, "")),
    text: cut(paragraph.map(plain).join(" "), textLimit),
    intro: cut(paragraph.join("\n"), introLimit),
    titleCell: prose === undefined ? null : at + 1,
    cells: summaries,
    routes: unique(code.flatMap((cell) => routesIn(cell.source))),
    exports: unique(
      cells.flatMap((cell) => (cell.type === "server" ? (cell.facts?.exports ?? []) : [])),
    ),
    packages: unique(facts.packages),
    secrets: unique(code.flatMap((cell) => envReads(cell.source))),
    missing: unique(facts.missing ?? []),
    lastResult: facts.lastResult ?? null,
  };
}
