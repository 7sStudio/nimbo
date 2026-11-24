// The colors of the page's design, held once for the notebook page and the output viewer: each
// as the oklch() the stylesheets write and the design's own #rrggbb beside it, light then dark, in groups that say what
// they are for. scripts/generate.ts writes them into page.css and viewer.css; hex() gives the HTML export and the
// contrast checks their sRGB figures. Surfaces are separated by tone and spacing, never by a box of hairlines.

/** A side of light-dark(): the page's light theme or its dark one. */
export type Theme = "light" | "dark";

/** One color in one theme: its oklch() arguments (`L% C h`, then `/ a%` when translucent) and the same sRGB color as
 * #rrggbb (#rrggbbaa when translucent), the design's figure, within one 8-bit step per channel (palette.test.ts). */
export type Shade = { readonly oklch: string; readonly hex: string };

/** A color of its own in both themes. */
export type Tone = { readonly light: Shade; readonly dark: Shade };

const tone = (light: string, lightHex: string, dark: string, darkHex: string): Tone => ({
  light: { oklch: light, hex: lightHex },
  dark: { oklch: dark, hex: darkHex },
});

/** One color in both themes. */
const fixed = (oklch: string, hex: string): Tone => tone(oklch, hex, oklch, hex);

const surfaces = {
  ground: tone("92.21% 0.0071 88.6", "#e7e5e0", "16.82% 0.0045 264.4", "#0e0f11"),
  side: tone("95.48% 0.0054 95.1", "#f1f0ec", "20.92% 0.0061 271.1", "#17181b"),
  code: tone("100% 0 0", "#ffffff", "25.62% 0.0098 268.3", "#212328"),
  "code-2": tone("98.53% 0.0029 84.6", "#fbfaf8", "23.14% 0.0078 274.6", "#1c1d21"),
  result: tone("96.71% 0.0041 91.4", "#f5f4f1", "21.36% 0.0061 271.1", "#18191c"),
  head: tone("93.75% 0.0058 84.6", "#eceae6", "28.09% 0.0096 268.3", "#27292e"),
  "head-focus": tone("86.73% 0.0101 87.5", "#d6d3cc", "37.17% 0.0143 269.3", "#3d4048"),
  well: tone("90.66% 0.0084 91.5", "#e2e0da", "30.96% 0.0111 271", "#2e3036"),
  grip: tone("81.13% 0.0103 87.5", "#c4c1ba", "37.93% 0.0142 269.3", "#3f424a"),
} as const;

// dark --faint is a step lighter than the design's #757983 (57.6 %), so the line numbers and quiet icons it paints pass
// 3:1 on the dark --code; its hex is the lighter one's
const ink = {
  fg: tone("20.09% 0.0081 274.5", "#15161a", "94.37% 0.0027 286.3", "#ececee"),
  "fg-2": tone("39.81% 0.014 269.3", "#44474f", "80.44% 0.0104 267.3", "#bcbfc6"),
  muted: tone("49.9% 0.0136 264.4", "#5f636b", "69.48% 0.0143 262.4", "#989da6"),
  faint: tone("60.33% 0.0126 269.5", "#7e8189", "62% 0.016 268.4", "#828690"),
} as const;

const orange = {
  hot: tone("52.99% 0.1713 37.7", "#b93a06", "72.61% 0.1773 42.5", "#ff7a40"),
  fill: tone("58.82% 0.1928 36.9", "#d6420a", "70.25% 0.1956 40.7", "#ff6a2b"),
  "fill-fg": tone("100% 0 0", "#ffffff", "20.09% 0.0081 274.5", "#15161a"),
} as const;

const states = {
  server: tone("50.48% 0.0896 179.5", "#0a7566", "76.18% 0.1128 179.8", "#4fc9b4"),
  client: tone("50.32% 0.204 264.1", "#2456d6", "74.73% 0.1293 264.5", "#84abff"),
  md: tone("48.08% 0.1005 77.2", "#7d5500", "76.72% 0.1259 84.1", "#d9ac4a"),
  agent: tone("49.34% 0.224 287.2", "#6238d6", "72.91% 0.1556 293.6", "#ad92ff"),
  "agent-soft": tone(
    "49.34% 0.224 287.2 / 15%",
    "#6238d626",
    "72.91% 0.1556 293.6 / 20%",
    "#ad92ff33",
  ),
  ok: tone("46.75% 0.104 157.2", "#126b42", "77.73% 0.1305 160.3", "#5fd09a"),
  err: tone("50.13% 0.1783 28.7", "#b3261e", "76.81% 0.137 26.1", "#ff8f85"),
  warn: { of: "hot" },
} as const;

const deep = {
  "hot-deep": tone("47.07% 0.1506 38", "#9d3105", "77.23% 0.1421 44.1", "#ff9566"),
  "err-deep": tone("46.43% 0.1641 28.6", "#a1221b", "76.81% 0.137 26.1", "#ff8f85"),
  "ok-deep": tone("43.34% 0.0958 157.3", "#10603b", "77.73% 0.1305 160.3", "#5fd09a"),
} as const;

const floating = {
  pop: tone("20.09% 0.0081 274.5", "#15161a", "34.96% 0.0141 274.5", "#383a42"),
  "pop-fg": fixed("100% 0 0", "#ffffff"),
  "pop-muted": tone("79.2% 0.0074 268.5", "#b9bbc0", "82.33% 0.0073 268.5", "#c3c5ca"),
  chip: { of: "fg" },
  "chip-fg": tone("100% 0 0", "#ffffff", "20.09% 0.0081 274.5", "#15161a"),
  // the soft edge under a cell header stuck to the top of the page (the design's .hd.stick)
  shade: tone("20.09% 0.0081 274.5 / 25%", "#15161a40", "0% 0 0 / 60%", "#00000099"),
} as const;

const editor = {
  line: tone("20.09% 0.0081 274.5 / 7%", "#15161a12", "100% 0 0 / 5%", "#ffffff0d"),
  guide: tone("20.09% 0.0081 274.5 / 11%", "#15161a1c", "100% 0 0 / 12%", "#ffffff1f"),
  "guide-on": tone("20.09% 0.0081 274.5 / 44%", "#15161a70", "100% 0 0 / 44%", "#ffffff70"),
  sel: tone("89.89% 0.0579 48.1", "#ffd3bd", "41.57% 0.1073 43.1", "#7a3413"),
  match: tone("90.58% 0.0762 73.7", "#ffd9a8", "42.48% 0.0813 68.5", "#6b4514"),
  "bracket-1": tone("47.72% 0.287 264.4", "#0431fa", "88.68% 0.1822 95.3", "#ffd700"),
  "bracket-2": tone("52.68% 0.1457 143.2", "#2a7f2a", "70.21% 0.1813 328.7", "#da70d6"),
  "bracket-3": tone("42.39% 0.1046 45.6", "#7b3814", "73.98% 0.1449 244.3", "#4db3ff"),
  "diff-removed": fixed("32.87% 0.0882 27.7", "#5a1f1a"),
  "diff-added": fixed("33.28% 0.0568 160.3", "#173f2c"),
  // the text of a diff's removed and added lines on their bands, in the agent edit's card and full diff
  "diff-removed-fg": fixed("88.11% 0.0631 29.3", "#ffc9c0"),
  // the agent's violet on the floating layer's dark surface (the agent edit's card), in both themes
  "agent-pop": fixed("77.15% 0.1291 293.8", "#b9a4ff"),
  "diff-added-fg": fixed("91.29% 0.0648 158.0", "#bff0d2"),
} as const;

const syntax = {
  kw: tone("45.63% 0.2246 266.4", "#1f3fd1", "72.32% 0.1429 265.4", "#7aa2ff"),
  ctl: tone("51.28% 0.2167 325.4", "#a020a8", "74.22% 0.1432 322.6", "#d68be0"),
  str: tone("50.16% 0.1398 39", "#a3401c", "77.99% 0.1076 47.8", "#f0a27a"),
  num: tone("51.27% 0.1133 159.5", "#0d7a4f", "79.22% 0.1204 159.7", "#6fd3a0"),
  fn: tone("48.23% 0.0952 84.7", "#77590a", "82.98% 0.1138 91.8", "#e2c56c"),
  key: tone("43.36% 0.141 256.9", "#0f4e9c", "79.5% 0.0912 250", "#8fc1f5"),
  cmt: tone("52.36% 0.0135 264.5", "#666a72", "69.48% 0.0143 262.4", "#989da6"),
  // types and classes in their own teal, apart from functions, as VS Code's Dark+ and Light+ paint them (the light one a step darker, for 4.5:1 on the result's tone)
  typ: tone("52.04% 0.0864 221.1", "#1d748c", "76.04% 0.1152 177.2", "#4ec9b0"),
  bool: { of: "kw" },
  nul: { of: "cmt" },
  punc: { of: "fg-2" },
} as const;

const all = {
  ...surfaces,
  ...ink,
  ...orange,
  ...states,
  ...deep,
  ...floating,
  ...editor,
  ...syntax,
};

/** The name of a color, its custom property without the dashes: `result` is `--result`. */
export type ColorName = keyof typeof all;

/** A color of its own, or another one's (`var(--of)`). */
export type Color = Tone | { readonly of: ColorName };

/** Every color by name; an alias names a color of its own (the type checks it). */
export const colors: Readonly<Record<ColorName, Color>> = all;

/** The colors in the stylesheets' order, each group under the note its comment carries. */
export const colorGroups: readonly {
  readonly note: string;
  readonly colors: Readonly<Partial<Record<ColorName, Color>>>;
}[] = [
  { note: "the surfaces, from the ground under the panels up to the code", colors: surfaces },
  {
    note: "ink, four steps (dark --faint lighter than the design's, to pass 3:1 on --code)",
    colors: ink,
  },
  {
    note: "orange is the caret, Run all and a running cell: --hot as text, --fill as a surface with --fill-fg on it",
    colors: orange,
  },
  {
    note: "where a cell runs, an agent's mark, success, and red for failure alone",
    colors: states,
  },
  { note: "the deeper orange, red and green a focused cell's header takes", colors: deep },
  {
    note: "the floating layer (tooltips, menus' dark cards), the ink square behind a focused cell's number and the shade under a stuck header",
    colors: floating,
  },
  {
    note: "the editor: the current line's band, the indent guides, the warm selection, the find match, the brackets",
    colors: editor,
  },
  { note: "syntax, the design's k c s n f p u", colors: syntax },
];

/** The sRGB figure of `name` in `theme` (#rrggbb, or #rrggbbaa when translucent), an alias's from the color it names. */
export function hex(name: ColorName, theme: Theme): string {
  const color = colors[name];
  return "of" in color ? hex(color.of, theme) : color[theme].hex;
}
