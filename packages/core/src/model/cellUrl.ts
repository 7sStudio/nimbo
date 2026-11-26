// The cell URL: the one name a cell's code runs under in both realms (the transform's
// filename, its `//# sourceURL`, the map's file and source, every stack frame of the cell). Each `/`-separated segment
// of the notebook ref is percent-encoded so that only RFC 3986 unreserved characters (A-Z a-z 0-9 - . _ ~) stay
// literal: V8 ignores a `//# sourceURL` that holds whitespace, and a stack line cannot delimit a URL that holds a space
// or a parenthesis. Plain refs (`demo.jsnb`, `sub/demo.jsnb`) are unchanged.
import type { CellId, NotebookRef } from "./ids.js";

/** encodeURIComponent, plus the four characters it leaves literal that are not unreserved: `!'()*`. */
const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment.toWellFormed()).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** The URL of `cell`'s code in `notebook`: `jsnb:///`, the ref with each segment encoded, `/`, the cell id, `.ts`. */
export function cellUrl(notebook: NotebookRef, cell: CellId): string {
  return `jsnb:///${notebook.split("/").map(encodeSegment).join("/")}/${cell}.ts`;
}
