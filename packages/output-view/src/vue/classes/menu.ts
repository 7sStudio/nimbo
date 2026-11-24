// A floating panel portalled to the body as its own .jsnb-ov root (the copy and export menus, the cheat sheet, a column
// filter): above the full-screen dialog, framed on --surface with the toolbar shadow, and its items.
export const menuPanel =
  "ov:z-(--z-overlay) ov:min-inline-[11.25rem] ov:rounded-box ov:border ov:border-border ov:bg-surface ov:p-1 ov:shadow-soft";

/** A menu's item, washed while Reka highlights it (pointer or keys). */
export const menuItem =
  "ov:cursor-pointer ov:rounded-small ov:px-2 ov:py-1 ov:text-interface ov:data-highlighted:bg-accent-soft ov:data-disabled:cursor-default ov:data-disabled:opacity-50";
