// A cell's name, as the cell header's Name column, the outline and Home's preview say it: the
// title the user gave it (meta.title), else what the cell is for, read from what is known of it (the routes it serves,
// what it exports or defines, a markdown cell's heading), so a column of names reads as a table of contents. With
// cells.titleFromFirstLine on, a code cell's first line (comment marks removed) names it before what it defines. Pure,
// so the page (with its live routes and graph) and the daemon (with a file's text alone, notebook.summary) name a cell
// alike.
import type { CellType } from "../model/cell.js";

/** What the analysis of a code cell knows: the names it defines and exports. */
export type NameFacts = {
  readonly defines: readonly string[];
  readonly exports: readonly string[];
};

/** The first line of `source` with text, trimmed; "" when it has none. */
export const firstLine = (source: string): string =>
  source
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "") ?? "";

// The comment marks a first line may open or close with: `//`, `/*`, `*`, `#`, `--`, `<!--`, and `*/`, `-->`.
const opening = /^(?:\/\/+|\/\*+|\*+(?!\/)|#+|--+|<!--)\s*/u;
const closing = /\s*(?:\*+\/|-->)$/u;

/** The first line of `source` that has text once its comment marks are removed, trimmed: `// get a user` is "get a
 * user", and a doc comment's opening line alone gives the line after it; "" when there is none. */
export function titleLine(source: string): string {
  for (const line of source.split("\n")) {
    const text = line.trim().replace(opening, "").replace(closing, "").trim();
    if (text !== "") return text;
  }
  return "";
}

/** The title the user gave the cell, trimmed; "" when it has none. */
export const ownTitle = (meta: { readonly title?: string | undefined } | undefined): string =>
  meta?.title?.trim() ?? "";

/** How a cell with no title of its own is named: `firstLine`, the cells.titleFromFirstLine setting. */
export type NameOptions = { readonly firstLine?: boolean };

/** Up to three names, then how many more: "stripe, balance", "a, b, c and 2 more". */
function listed(names: readonly string[]): string {
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${shown} and ${String(names.length - 3)} more` : shown;
}

/** A markdown cell's name: its first heading without the marks, else its first line. */
const proseName = (source: string): string => firstLine(source).replace(/^#+\s*/u, "");

const cut = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** The routes a cell's text declares, `route("POST /webhook", …)`, in source order and each once: a plain pattern
 * rather than the parser, so a cell that does not parse, or a notebook that is not open, still names them. */
export function routesIn(source: string): readonly string[] {
  const pattern = /\broute\s*\(\s*["'`]([A-Z]+ \/[^"'`]*)["'`]/gu;
  return [...new Set([...source.matchAll(pattern)].flatMap((match) => match[1] ?? []))];
}

/** The names a cell's text declares, read with a plain pattern: what a cell the analysis knows nothing of would
 * define. */
function declared(source: string): readonly string[] {
  const pattern =
    /^(?:export\s+)?(?:async\s+)?(?:function\*?\s+|class\s+|(?:const|let|var)\s+)([A-Za-z_$][\w$]*)/gmu;
  return [...new Set([...source.matchAll(pattern)].flatMap((match) => match[1] ?? []))];
}

/** The name a code cell's text gives it: the routes it declares, else the names; "" when it declares none. */
function textName(source: string): string {
  const routes = routesIn(source);
  if (routes.length > 0) return listed(routes);
  const names = declared(source);
  return names.length > 0 ? listed(names) : "";
}

/**
 * The cell's name: its own title (meta.title); a markdown cell's heading; with `options.firstLine` its first line,
 * comment marks removed; the routes it serves (`served`: the kernel's, while it listens), what it exports, what it
 * defines; then the routes and names its text declares (a cell that does not parse, or a route cell that defines
 * nothing). "" for a code cell none of these names, "empty" for a cell with no text.
 */
export function cellName(
  cell: {
    readonly type: CellType;
    readonly source: string;
    readonly meta?: { readonly title?: string | undefined };
  },
  facts: NameFacts | undefined,
  served: readonly string[],
  options: NameOptions = {},
): string {
  const own = ownTitle(cell.meta);
  if (own !== "") return own;
  if (cell.type === "markdown") return cut(proseName(cell.source), 60) || "empty";
  if (firstLine(cell.source) === "") return "empty";
  const line = options.firstLine === true ? cut(titleLine(cell.source), 60) : "";
  return line || codeName(cell.source, facts, served);
}

/** A code cell's derived name: the routes it serves, what it exports or defines, else what its text declares. */
function codeName(source: string, facts: NameFacts | undefined, served: readonly string[]): string {
  const known = [served, facts?.exports ?? [], facts?.defines ?? []].find(
    (names) => names.length > 0,
  );
  return known === undefined ? textName(source) : listed(known);
}
