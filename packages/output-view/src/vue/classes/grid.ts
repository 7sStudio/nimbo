// The grid's lines: a header and rows of 24 px on the columns of --columns (the row's number and
// action, frozen at the start edge, then one per key).

/** 24 px with the separator inside, so a row ends where the next begins, and one track of that height, so the row's
 * 24 px action reaches over the separator's pixel instead of growing the track: the frozen first cell's background then
 * covers no separator, and nothing passes the row's bottom edge. */
const line =
  "ov:box-border ov:grid ov:block-6 ov:min-inline-max ov:grid-cols-(--columns) ov:grid-rows-[minmax(0,1fr)] ov:items-center ov:border-be ov:border-border";

/** The header, which stays at the top of the scroller over the rows. */
export const gridHead = `${line} ov:sticky ov:inset-bs-0 ov:z-(--z-toolbar) ov:bg-bg ov:font-sans ov:text-small ov:font-medium ov:text-fg-2`;

/** A row placed by --row-y. Rows keep --bg (the syntax colors reach 4.5:1 there only): a selected row is ringed, the
 * active one barred, and a hovered one ringed in --border-2, a selected one too (aria-selected:hover outweighs
 * aria-selected, so no !important). */
export const gridRow = `${line} ov:absolute ov:inset-bs-0 ov:inset-s-0 ov:translate-y-(--row-y) ov:cursor-pointer ov:aria-selected:outline ov:aria-selected:-outline-offset-1 ov:aria-selected:outline-accent ov:data-active:shadow-[inset_2px_0_0_var(--accent)] ov:hover:outline ov:hover:-outline-offset-1 ov:hover:outline-border-2 ov:aria-selected:hover:outline-border-2`;

/** The row's number and its action, frozen at the start edge: a grid wider than its output scrolls its cells under it,
 * and at rest it covers none. Sticky, so positioned, it paints over the static cells with no z-index. The active
 * row's bar is drawn on it too, since it paints over the row's own. */
export const gridIndex =
  "ov:sticky ov:inset-s-0 ov:flex ov:items-center ov:justify-between ov:self-stretch ov:bg-bg ov:ps-2 ov:pe-0.5 ov:text-fg-2 ov:in-data-active:shadow-[inset_2px_0_0_var(--accent)]";
