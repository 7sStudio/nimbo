// V8 stack lines parsed into the Frames, and cell positions rewritten in stack text: a frame in a
// cell is mapped through the cell's source map, kernel-internal frames (the kernel's files, the user-code frame
// included), node:internal frames and frames without a location are dropped, from the frames and from the raw stack
// alike. A cell is known by the exact URL it was compiled under; no URL is parsed with a pattern, so whatever the
// notebook ref holds, its positions are found.
import { sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { Frame } from "@jsnb/core";

/** The part of node:module's SourceMap the frames use: 1-based positions in, 1-based positions out. */
type CellMap = {
  readonly findOrigin: (
    line: number,
    col: number,
  ) => { readonly lineNumber?: number; readonly columnNumber?: number };
};

/** The cells this kernel compiled, by the exact URL each runs under, with their source maps. */
export type CellPositions = {
  /** The cell compiled under `url`, its exact script name, or undefined. */
  readonly cellOf: (url: string) => string | undefined;
  /** Every cell URL compiled so far; a new array whenever one is added. */
  readonly cellUrls: () => readonly string[];
  /** The source map of a cell compiled in this kernel, by cell id. */
  readonly mapFor: (cell: string) => CellMap | undefined;
};

export type FrameContext = CellPositions & {
  /** Directories whose frames are the kernel's own. */
  readonly internal: readonly string[];
};

type RawFrame = {
  readonly fn?: string;
  readonly file: string;
  readonly line: number;
  readonly col: number;
};

const frameLine = /^\s*at\s+(?:async\s+)?(?:new\s+)?(?:(.+?)\s+\((.+)\)|(.+))$/;
const position = /^(.*):(\d+):(\d+)$/;

/** The located frames of a V8 stack text, in order; lines that are not frames are skipped. Never throws. */
export function parseStack(stack: string): readonly RawFrame[] {
  const frames: RawFrame[] = [];
  for (const text of stack.split("\n")) {
    const match = frameLine.exec(text);
    const at = match ? position.exec(match[2] ?? match[3] ?? "") : null;
    if (!match || !at) continue;
    const fn = match[1];
    frames.push({
      ...(fn === undefined ? {} : { fn }),
      file: at[1] ?? "",
      line: Number(at[2]),
      col: Number(at[3]),
    });
  }
  return frames;
}

/** A `file:` URL as a path; a URL Node cannot turn into a path stays as written. */
function asPath(file: string): string {
  if (!file.startsWith("file:")) return file;
  try {
    return fileURLToPath(file);
  } catch {
    // A remote-host or malformed file URL: keeping the text is the most faithful thing to show.
    return file;
  }
}

const isInside = (file: string, dirs: readonly string[]): boolean =>
  dirs.some((dir) => file.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`));

function cellFrame(raw: RawFrame, cell: string, context: FrameContext): Frame {
  const origin = context.mapFor(cell)?.findOrigin(raw.line, raw.col);
  const line = origin?.lineNumber ?? raw.line;
  const col = origin?.columnNumber ?? raw.col;
  return raw.fn === undefined ? { cell, line, col } : { cell, line, col, fn: raw.fn };
}

/** The Frame a parsed V8 frame becomes, or undefined when it is dropped. */
export function toFrame(raw: RawFrame, context: FrameContext): Frame | undefined {
  const cell = context.cellOf(raw.file);
  if (cell !== undefined) return cellFrame(raw, cell, context);
  const file = asPath(raw.file);
  if (file.startsWith("node:internal/") || isInside(file, context.internal)) return undefined;
  const frame = { file, line: raw.line, col: raw.col };
  return raw.fn === undefined ? frame : { ...frame, fn: raw.fn };
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One pattern per set of URLs: each URL, longest first, followed by `:line:col`. */
const patterns = new WeakMap<readonly string[], RegExp>();

function positionsOf(urls: readonly string[]): RegExp | undefined {
  if (urls.length === 0) return undefined;
  const known = patterns.get(urls);
  if (known) return known;
  const alternatives = [...urls].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const pattern = new RegExp(`(${alternatives.join("|")}):(\\d+):(\\d+)`, "g");
  patterns.set(urls, pattern);
  return pattern;
}

/** `text` with every cell position (a cell's exact URL, then `:line:col`) rewritten to the cell's own line and column. */
export function rewritePositions(text: string, cells: CellPositions): string {
  const pattern = positionsOf(cells.cellUrls());
  if (!pattern) return text;
  return text.replace(pattern, (whole: string, url: string, line: string, col: string) => {
    const cell = cells.cellOf(url);
    const origin =
      cell === undefined ? undefined : cells.mapFor(cell)?.findOrigin(Number(line), Number(col));
    if (origin?.lineNumber === undefined || origin.columnNumber === undefined) return whole;
    return `${url}:${String(origin.lineNumber)}:${String(origin.columnNumber)}`;
  });
}

/**
 * `stack` without the frames `toFrame` drops (the kernel's own files, Node's internals, frames with no location), as
 * Jupyter hides IPython's: the user reads their cells' frames and their packages', not the kernel's. Every other line
 * (the message, a multi-line message, the cause's header) stays.
 */
export function userStack(stack: string, context: FrameContext): string {
  return stack
    .split("\n")
    .filter((text) => {
      const match = frameLine.exec(text);
      if (!match) return true;
      const at = position.exec(match[2] ?? match[3] ?? "");
      if (!at) return false;
      const raw = { file: at[1] ?? "", line: Number(at[2]), col: Number(at[3]) };
      return toFrame(raw, context) !== undefined;
    })
    .join("\n");
}
