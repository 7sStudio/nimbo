// The links in the language popups and the hint dialog: a JSDoc `{@link}` to a symbol
// goes to its definition as F12 does (the daemon writes `#jsnb-cell=<cell>:<line>:<character>` or
// `#jsnb-file=<path>:<line>`, language/src/queries.ts), a web address opens in a new tab. Small and outside the lazy
// chunk, so the dialog can follow a link too; the chunk gives the way to a definition once it is loaded.

/** A definition a link names: a place in a cell, or a line in a file outside the cells. */
export type LinkPlace =
  | { readonly cell: string; readonly line: number; readonly character: number }
  | { readonly file: string; readonly line: number };

/** The place `href` names, or undefined for a web address or anything else. */
function placeOf(href: string): LinkPlace | undefined {
  const cell = /^#jsnb-cell=(c_[0-9a-z]+):(\d+):(\d+)$/u.exec(href);
  if (cell) return { cell: cell[1] ?? "", line: Number(cell[2]), character: Number(cell[3]) };
  const file = /^#jsnb-file=(.+):(\d+)$/u.exec(href);
  return file ? { file: decodeURIComponent(file[1] ?? ""), line: Number(file[2]) } : undefined;
}

let follower: ((place: LinkPlace) => void) | undefined;

/** The language chunk's way to a definition (client.ts). */
export function setLinkFollower(follow: (place: LinkPlace) => void): void {
  follower = follow;
}

/** Follows a link's `href`: a definition through the chunk, a web address in a new tab; true when it was one. */
function followLink(href: string): boolean {
  const place = placeOf(href);
  if (place !== undefined) {
    follower?.(place);
    return true;
  }
  if (!/^https?:\/\//u.test(href)) return false;
  window.open(href, "_blank", "noopener,noreferrer");
  return true;
}

/** A click on a link follows it instead of navigating the page; returns whether it did. */
export function clickedLink(event: MouseEvent): boolean {
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  const href = anchor?.getAttribute("href");
  if (href === null || href === undefined) return false;
  event.preventDefault();
  return followLink(href);
}
