// The viewer's token names, the two palettes as sRGB figures, and the WCAG 2 contrast check the
// tests run over the syntax tokens. The colors are @jsnb/tokens', the palette the notebook page shows too, read through
// the viewer's names (viewerTones, which theme.css maps alike); only the sixteen ANSI colors of streams are the viewer's.
//
// The viewer paints --bg, the shared result tone (#f5f4f1, #18191c), so 4.5:1 is checked there. Rows keep --bg and mark
// hover and selection with an inset ring, never a surface tone a token may fall under 4.5:1 on.
//
// The sixteen named ANSI colors are VS Code's terminal colors (Light+ and Dark+), each moved along its OKLCH lightness,
// hue and chroma kept, to the first 8-bit color at 4.5:1 on --bg where it fell short, as VS Code's
// terminal.integrated.minimumContrastRatio (default 4.5) does; palette.test.ts derives them again from VS Code's.

import type { ColorName } from "@jsnb/tokens";
import { hex } from "@jsnb/tokens";

/** The syntax tokens. */
export const syntaxTokens = ["key", "str", "num", "bool", "nul", "typ", "fn", "punc"] as const;
export type SyntaxToken = (typeof syntaxTokens)[number];

/** The surface, text, border, accent and state tokens the viewer paints with. */
export const surfaceTokens = [
  "bg",
  "bg-2",
  "surface",
  "surface-2",
  "surface-3",
  "border",
  "border-2",
  "fg",
  "fg-2",
  "muted",
  "accent",
  "client",
  "ok",
  "warn",
  "err",
  "tip-bg",
  "tip-fg",
] as const;
export type SurfaceToken = (typeof surfaceTokens)[number];

export type PaletteToken = SyntaxToken | SurfaceToken;
export type ThemeName = "light" | "dark";
export type Palette = Readonly<Record<PaletteToken, string>>;

/** The background the viewer paints (theme.css `.jsnb-ov`), which every syntax token is checked against. */
export const viewerBackground: SurfaceToken = "bg";

/** The minimum contrast of a token against the viewer background (WCAG AA for text). */
export const minimumContrast = 4.5;

/** The shared color each of the viewer's names paints with; a name the palette shares is its own. theme.css declares
 * the others alike (`--bg: var(--result)`), and the theme test compares the two. */
export const viewerTones: Readonly<Record<PaletteToken, ColorName>> = {
  bg: "result",
  "bg-2": "result",
  surface: "code",
  "surface-2": "head",
  "surface-3": "well",
  border: "well",
  "border-2": "grip",
  fg: "fg",
  "fg-2": "fg-2",
  muted: "muted",
  accent: "fg",
  client: "client",
  ok: "ok",
  warn: "warn",
  err: "err",
  "tip-bg": "pop",
  "tip-fg": "pop-fg",
  key: "key",
  str: "str",
  num: "num",
  bool: "bool",
  nul: "nul",
  typ: "typ",
  fn: "fn",
  punc: "punc",
};

/** `theme`'s figure of every token: the names first, each then replaced by its tone's hex. */
const paletteOf = (theme: ThemeName): Palette => {
  const palette: Record<PaletteToken, string> = { ...viewerTones };
  for (const token of [...surfaceTokens, ...syntaxTokens])
    palette[token] = hex(viewerTones[token], theme);
  return palette;
};

/** Each theme's palette as #rrggbb, the shared tokens' figures through viewerTones. */
export const palettes: Readonly<Record<ThemeName, Palette>> = {
  light: paletteOf("light"),
  dark: paletteOf("dark"),
};

/** The named ANSI colors 0–15 (black, red, green, yellow, blue, magenta, cyan, white, then the bright eight) per
 * theme, theme.css's --ansi-0 … --ansi-15; 256-color and 24-bit colors are drawn as the stream gives them. */
export const ansiPalettes: Readonly<Record<ThemeName, readonly string[]>> = {
  light: [
    "#000000",
    "#cd3131",
    "#008200",
    "#727400",
    "#0451a5",
    "#bc05bc",
    "#00799c",
    "#555555",
    "#666666",
    "#cd3131",
    "#008200",
    "#727400",
    "#0451a5",
    "#bc05bc",
    "#00799c",
    "#707070",
  ],
  dark: [
    "#818181",
    "#e54a45",
    "#0dbc79",
    "#e5e510",
    "#3783da",
    "#ca4dc9",
    "#11a8cd",
    "#e5e5e5",
    "#818181",
    "#f14c4c",
    "#23d18b",
    "#f5f543",
    "#3b8eea",
    "#d670d6",
    "#29b8db",
    "#e5e5e5",
  ],
};

/** The 8-bit channels of `#rrggbb`. */
function channels(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const linear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2 relative luminance of `#rrggbb`. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2 contrast ratio of two `#rrggbb` colors, from 1 to 21. */
export function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
