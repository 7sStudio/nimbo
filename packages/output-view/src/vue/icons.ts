// The icon set of the viewer as SVG path data on a 24-unit grid (own drawings, stroked, no fill).

export const iconPaths = {
  chevronRight: "M9 6l6 6-6 6",
  chevronDown: "M6 9l6 6 6-6",
  search: "M11 4a7 7 0 1 1 0 14a7 7 0 1 1 0-14z M21 21l-5-5",
  filter: "M3 5h18l-7 8v6l-4 2v-8z",
  maximize: "M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7",
  fit: "M4 9V4h5 M20 15v5h-5 M4 4l6 6 M20 20l-6-6",
  expandAll: "M7 7l5 5 5-5 M7 13l5 5 5-5",
  collapseAll: "M7 11l5-5 5 5 M7 17l5-5 5 5",
  copy: "M9 9h11v11H9z M5 15H4V4h11v1",
  download: "M12 3v12 M7 10l5 5 5-5 M5 21h14",
  external: "M14 3h7v7 M10 14L21 3 M19 14v6H4V5h6",
  close: "M6 6l12 12 M18 6L6 18",
  up: "M12 19V5 M5 12l7-7 7 7",
  down: "M12 5v14 M5 12l7 7 7-7",
  help: "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7 M12 17h.01",
  stop: "M7 7h10v10H7z",
  back: "M10 6l-6 6 6 6 M4 12h16",
  wrap: "M4 6h16 M4 12h13a3 3 0 0 1 0 6h-4 M13 16l-2 2 2 2 M4 18h5",
  clock: "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z M12 7v5l3 2",
  code: "M8 6l-6 6 6 6 M16 6l6 6-6 6",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
} as const;

export type IconName = keyof typeof iconPaths;
