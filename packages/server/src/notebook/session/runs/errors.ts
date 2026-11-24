// The ErrorInfo of a run that failed on the daemon's side of 02-architecture §5 (a transform error, a missing package,
// a kernel that would not start): the error's name, message and data, a frame at the cell's line when the error names
// one (a syntax error) with an excerpt of the source there, a caret under the column (`data.excerpt`),
// and `raw` as the user reads it, not the daemon's own stack.
import type { CellId, ErrorInfo, Frame } from "@jsnb/core";
import { toErrorInfo } from "@jsnb/core";

const numberAt = (data: unknown, key: string): number | undefined => {
  const value: unknown =
    typeof data === "object" && data !== null ? Reflect.get(data, key) : undefined;
  return typeof value === "number" ? value : undefined;
};

/** A frame on `cell` at the line and column an analysis error's data names (InvalidSyntax and its siblings). */
function framesOf(error: unknown, cell: CellId): readonly Frame[] {
  const data: unknown = error instanceof Error ? Reflect.get(error, "data") : undefined;
  const line = numberAt(data, "line");
  const col = numberAt(data, "col");
  return line === undefined || col === undefined ? [] : [{ cell, line, col }];
}

/** The characters shown each side of the column on a long line (minified code pasted in a cell). */
const reach = 60;

/** The line breaks TypeScript counts, so a line number it reports finds its line. */
const breaks = /\r\n|[\n\r\u2028\u2029]/u;

/** `text` cut to the window `[from, from + 2 * reach)`, an ellipsis where it was cut. */
const windowOf = (text: string, from: number): string =>
  `${from > 0 ? "…" : ""}${text.slice(from, from + 2 * reach)}${text.length > from + 2 * reach ? "…" : ""}`;

/** The line before `line` and `line` itself of `source`, numbered, with a caret under `col` (1-based):
 *
 *     1 | const a = 1;
 *   > 2 | const x = ;
 *       |           ^
 *
 * The caret's indent keeps the line's own tabs, so it lands under the column however wide a tab shows; a long line is
 * cut to a window around the column. */
export function excerptOf(source: string, line: number, col: number): string | undefined {
  const lines = source.split(breaks);
  const text = lines[line - 1];
  if (text === undefined) return undefined;
  const at = Math.min(Math.max(col - 1, 0), text.length);
  const from = text.length > 2 * reach ? Math.max(at - reach, 0) : 0;
  const shift = from > 0 ? 1 : 0; // the ellipsis before the window
  const width = String(line).length;
  // the line before is context: whole when it fits, else cut at the same place (or its own end, never to nothing)
  const cut = (each: string) =>
    each.length > 2 * reach ? windowOf(each, Math.min(from, each.length - 2 * reach)) : each;
  const numbered = (n: number, mark: string) =>
    `${mark} ${String(n).padStart(width)} | ${n === line ? windowOf(text, from) : cut(lines[n - 1] ?? "")}`;
  const shown = line > 1 ? [numbered(line - 1, " ")] : [];
  // one space per UTF-16 unit, a tab kept: an emoji (two units) shows two columns wide, as its two spaces do
  const indent = `${" ".repeat(shift)}${text.slice(from, at).replace(/[^\t]/g, " ")}`;
  const caret = `  ${" ".repeat(width)} | ${indent}^`;
  return [...shown, numbered(line, ">"), caret].join("\n");
}

/** The ErrorInfo a run ends with when `error` stopped it before the kernel ran anything; `source`, the cell's, gives
 * an error with a place its excerpt. */
export function runError(error: unknown, cell: CellId, source?: string): ErrorInfo {
  const frames = framesOf(error, cell);
  const info = toErrorInfo(error, frames);
  const [at] = frames;
  const excerpt =
    at === undefined || source === undefined ? undefined : excerptOf(source, at.line, at.col);
  const data = excerpt === undefined ? info.data : { ...info.data, excerpt };
  return { ...info, ...(data === undefined ? {} : { data }), raw: `${info.name}: ${info.message}` };
}
