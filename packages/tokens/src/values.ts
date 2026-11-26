// The tokens beside the colors that the notebook page and the output viewer both read, held once: the families, the two
// text sizes, the corners, the motion, the four z-index layers, the shadow made from the ink and the scrim.
// Sizes are rem at the 16 px root. scripts/generate.ts writes them after the colors.

/** The values in the stylesheets' order, each group under the note its comment carries. */
export const valueGroups: readonly {
  readonly note: string;
  readonly values: Readonly<Record<string, string>>;
}[] = [
  {
    note: "a control's shadow from the ink, and the scrim behind a dialog, which dims the page in both themes",
    values: {
      shadow: "0 1px 2px color-mix(in oklch, var(--fg) 6%, transparent)",
      scrim: "light-dark(color-mix(in oklch, var(--fg) 35%, transparent), oklch(0% 0 0 / 55%))",
    },
  },
  {
    note: "the page bundles both families (ui's theme/fonts.css); the viewer alone falls back to the system's",
    values: {
      font: '"Geist", system-ui, sans-serif',
      mono: '"JetBrains Mono", ui-monospace, monospace',
    },
  },
  {
    note: "type at the 16 px root: 12 px interface, 13 px code and values",
    values: { "text-ui": "0.75rem", "text-code": "0.8125rem" },
  },
  {
    note: "square corners: a cell or a card has none, a control a 2 px ease",
    values: { "radius-card": "0", "radius-control": "0.125rem", "radius-pill": "999rem" },
  },
  {
    note: "motion: hover and open, the crossfade, one easing",
    values: { "ease-out": "cubic-bezier(0.2, 0.8, 0.2, 1)", dur: "150ms", "dur-fade": "200ms" },
  },
  {
    note: "the four z-index layers",
    values: { "z-toolbar": "10", "z-panel": "20", "z-overlay": "30", "z-toast": "40" },
  },
];
