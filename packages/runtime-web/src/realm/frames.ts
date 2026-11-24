// Stack frames (04-kernel §5.3): Chromium's `error.stack` parsed, cell frames mapped to the TypeScript source,
// runtime-web's own frames dropped (from the frames and from the raw stack), package frames kept with their URL.
import type { Frame } from "@jsnb/core";
import type { TraceMap } from "@jridgewell/trace-mapping";
import {
  GREATEST_LOWER_BOUND,
  LEAST_UPPER_BOUND,
  originalPositionFor,
} from "@jridgewell/trace-mapping";

import type { CellFile, CellFiles } from "./files.js";

type RawFrame = {
  readonly url: string;
  readonly line: number;
  readonly col: number;
  readonly fn?: string;
};

/** `    at fn (url:line:col)`, `    at url:line:col`, `    at async fn (url:line:col)`. */
const framePattern = /^\s*at (?:async )?(?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;

function parseStack(stack: string): RawFrame[] {
  const frames: RawFrame[] = [];
  for (const text of stack.split("\n")) {
    const match = framePattern.exec(text);
    if (!match) continue;
    const [, fn, url = "", line = "", col = ""] = match;
    if (url.includes(" ")) continue; // an eval without a sourceURL (`eval at …`) names no file
    frames.push({ url, line: Number(line), col: Number(col), ...(fn === undefined ? {} : { fn }) });
  }
  return frames;
}

const withoutQuery = (url: string): string => url.replace(/[?#].*$/, "");

/**
 * Whether a frame belongs to runtime-web's own modules, given the URL of one of them: under the parent of its
 * directory (`src/` here, the app's own root once bundled, which may be the origin root), except the daemon's `/npm/`
 * packages and workspace files, which 04-kernel §5.3 keeps as package frames wherever the app is served from.
 */
function internalTo(moduleUrl: string): (url: string) => boolean {
  const own = new URL("..", withoutQuery(moduleUrl)).href;
  const packages = new URL("/npm/", moduleUrl).href;
  return (url) => {
    const clean = withoutQuery(url);
    return clean.startsWith(own) && !clean.startsWith(packages);
  };
}

// Read through a variable: Vite rewrites `new URL("…", import.meta.url)` into an asset URL.
const isInternal = internalTo(import.meta.url);

type Position = { readonly line: number; readonly col: number };

/** The original 1-based line and column through the run's map, or undefined when the map has nothing there. */
function original(tracer: TraceMap | undefined, frame: RawFrame): Position | undefined {
  if (tracer === undefined) return undefined;
  for (const bias of [GREATEST_LOWER_BOUND, LEAST_UPPER_BOUND] as const) {
    const hit = originalPositionFor(tracer, { line: frame.line, column: frame.col - 1, bias });
    if (hit.line !== null) return { line: hit.line, col: hit.column + 1 };
  }
  return undefined;
}

/** A frame in a cell: mapped to the TypeScript source, or kept at its generated position when it cannot be. */
function cellFrame(file: CellFile, frame: RawFrame): Frame {
  // The cell function itself shows as `eval` (the indirect eval of 04-kernel §4): no name of the user's.
  const fn = frame.fn === undefined || frame.fn === "eval" ? {} : { fn: frame.fn };
  const position = original(file.tracer(), frame) ?? { line: frame.line, col: frame.col };
  return { cell: file.cell, ...position, ...fn };
}

const fileFrame = (frame: RawFrame): Frame => ({
  file: frame.url,
  line: frame.line,
  col: frame.col,
  ...(frame.fn === undefined ? {} : { fn: frame.fn }),
});

/** The frames of a stack as ErrorInfo carries them. */
export function framesOf(stack: string, files: CellFiles): Frame[] {
  const frames: Frame[] = [];
  for (const frame of parseStack(stack)) {
    const file = files.find(frame.url);
    if (file) frames.push(cellFrame(file, frame));
    else if (!isInternal(frame.url)) frames.push(fileFrame(frame));
  }
  return frames;
}

/** The cell of the first frame in a known cell file, for an error that escaped every wrapper (04-kernel §5.3). */
export function cellOfStack(stack: string, files: CellFiles): string | undefined {
  for (const frame of parseStack(stack)) {
    const file = files.find(frame.url);
    if (file) return file.cell;
  }
  return undefined;
}

/** `    at …` with or without a location: a frame line of Chromium's stack. */
const atLine = /^\s*at /u;

/**
 * `stack` without the frames `framesOf` drops (runtime-web's own modules, frames with no location), as Jupyter hides
 * IPython's: the cells' frames and the packages' stay, and every line that is no frame (the message, a cause).
 */
export function userStackOf(stack: string, files: CellFiles): string {
  return stack
    .split("\n")
    .filter((text) => {
      if (!atLine.test(text)) return true;
      const [frame] = parseStack(text);
      return frame !== undefined && (files.find(frame.url) !== undefined || !isInternal(frame.url));
    })
    .join("\n");
}
