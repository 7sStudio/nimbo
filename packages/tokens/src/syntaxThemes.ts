// The syntax themes the editor.syntaxTheme setting picks from (the owner, 2026-11-15): each published theme's own token
// colours, light then dark, for the roles the page's syntax tokens name. VS Code's Light+ and Dark+ are the default;
// "nimbo" is the palette's own (palette.ts), so it has no table here. Sources: VS Code's theme-defaults, GitHub's
// Primer themes, Cursor Light and Dark (a copy of Anysphere's theme files), JetBrains New Dark and IntelliJ Light,
// Atom's One, Catppuccin Latte and Mocha, Tokyo Night Day and Night. A colour that falls short of 4.5:1 on the page's
// surfaces is moved just far enough to reach it, as the viewer's ANSI colours are (readable below).

/** The page tokens a syntax theme sets (their custom properties without the dashes). */
export const syntaxRoles = [
  "kw",
  "ctl",
  "str",
  "num",
  "bool",
  "nul",
  "typ",
  "fn",
  "key",
  "cmt",
  "punc",
] as const;
export type SyntaxRole = (typeof syntaxRoles)[number];

/** One theme: a #rrggbb (or #rrggbbaa) per role, in each scheme. */
export type SyntaxTheme = {
  readonly light: Readonly<Record<SyntaxRole, string>>;
  readonly dark: Readonly<Record<SyntaxRole, string>>;
};

type Colors = Readonly<Record<SyntaxRole, string>>;

/** The surfaces code sits on, the one each scheme reads worst on: the result's tone in light, the code's in dark. */
const grounds = { light: "#f5f4f1", dark: "#212328" } as const;
/** WCAG AA for text, as the palette's own syntax colours and the viewer's ANSI colours reach. */
const minimumContrast = 4.5;

const channels = (hex: string): number[] =>
  [1, 3, 5, 7].map((at) => Number.parseInt(hex.slice(at, at + 2) || "ff", 16) / 255);
const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r = 0, g = 0, b = 0]: readonly number[]): number =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const contrast = (a: readonly number[], b: readonly number[]): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};
const hexOf = (rgb: readonly number[]): string =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** `hex` on `scheme`'s ground, solid (a translucent colour laid on it), moved toward black in light or white in dark
 * by small steps until it reaches 4.5:1 there; a colour that already does is kept as it is. */
export function readable(hex: string, scheme: "light" | "dark"): string {
  const ground = channels(grounds[scheme]).slice(0, 3);
  const [r = 0, g = 0, b = 0, a = 1] = channels(hex);
  const byte = (c: number): number => Math.round(Math.min(1, Math.max(0, c)) * 255) / 255;
  let rgb = [r, g, b].map((c, at) => byte(c * a + (ground[at] ?? 0) * (1 - a)));
  const solid = a === 1 ? hex.slice(0, 7) : hexOf(rgb);
  if (contrast(rgb, ground) >= minimumContrast) return solid;
  const target = scheme === "light" ? 0 : 1;
  for (let step = 0; step < 100 && contrast(rgb, ground) < minimumContrast; step += 1)
    rgb = rgb.map((c) => byte(c + (target - c) * 0.04));
  return hexOf(rgb);
}

/** A table from its distinct colours: keywords also paint control flow unless given, and literals take one colour. */
const side = (
  scheme: "light" | "dark",
  c: {
    kw: string;
    ctl?: string;
    str: string;
    num: string;
    lit?: string;
    typ: string;
    fn: string;
    key: string;
    cmt: string;
    punc: string;
  },
): Colors => {
  const r = (hex: string) => readable(hex, scheme);
  return {
    kw: r(c.kw),
    ctl: r(c.ctl ?? c.kw),
    str: r(c.str),
    num: r(c.num),
    bool: r(c.lit ?? c.kw),
    nul: r(c.lit ?? c.kw),
    typ: r(c.typ),
    fn: r(c.fn),
    key: r(c.key),
    cmt: r(c.cmt),
    punc: r(c.punc),
  };
};

// one line per side, so each theme reads as its own row
// prettier-ignore
export const syntaxThemes = {
  vscode: {
    light: side("light", { kw: "#0000ff", ctl: "#af00db", str: "#a31515", num: "#098658", typ: "#267f99", fn: "#795e26", key: "#001080", cmt: "#008000", punc: "#3b3b3b" }),
    dark: side("dark", { kw: "#569cd6", ctl: "#c586c0", str: "#ce9178", num: "#b5cea8", typ: "#4ec9b0", fn: "#dcdcaa", key: "#9cdcfe", cmt: "#6a9955", punc: "#cccccc" }),
  },
  github: {
    light: side("light", { kw: "#cf222e", str: "#0a3069", num: "#0550ae", lit: "#0550ae", typ: "#953800", fn: "#8250df", key: "#0550ae", cmt: "#6e7781", punc: "#1f2328" }),
    dark: side("dark", { kw: "#ff7b72", str: "#a5d6ff", num: "#79c0ff", lit: "#79c0ff", typ: "#ffa657", fn: "#d2a8ff", key: "#79c0ff", cmt: "#8b949e", punc: "#e6edf3" }),
  },
  cursor: {
    light: side("light", { kw: "#b3003f", str: "#9e94d5", num: "#b8448b", typ: "#206595", fn: "#db704b", key: "#6049b3", cmt: "#141414ad", punc: "#141414eb" }),
    dark: side("dark", { kw: "#82d2ce", str: "#e394dc", num: "#ebc88d", typ: "#87c3ff", fn: "#efb080", key: "#aaa0fa", cmt: "#e4e4e45e", punc: "#e4e4e4eb" }),
  },
  jetbrains: {
    light: side("light", { kw: "#0033b3", str: "#067d17", num: "#1750eb", typ: "#000000", fn: "#00627a", key: "#871094", cmt: "#8c8c8c", punc: "#080808" }),
    dark: side("dark", { kw: "#cf8e6d", str: "#6aab73", num: "#2aacb8", typ: "#6fafbd", fn: "#56a8f5", key: "#c77dbb", cmt: "#7a7e85", punc: "#bcbec4" }),
  },
  one: {
    light: side("light", { kw: "#a626a4", str: "#50a14f", num: "#986801", lit: "#986801", typ: "#c18401", fn: "#4078f2", key: "#e45649", cmt: "#a0a1a7", punc: "#383a42" }),
    dark: side("dark", { kw: "#c678dd", str: "#98c379", num: "#d19a66", lit: "#d19a66", typ: "#e5c07b", fn: "#61afef", key: "#e06c75", cmt: "#7f848e", punc: "#abb2bf" }),
  },
  catppuccin: {
    light: side("light", { kw: "#8839ef", str: "#40a02b", num: "#fe640b", lit: "#fe640b", typ: "#df8e1d", fn: "#1e66f5", key: "#e64553", cmt: "#7c7f93", punc: "#7c7f93" }),
    dark: side("dark", { kw: "#cba6f7", str: "#a6e3a1", num: "#fab387", lit: "#fab387", typ: "#f9e2af", fn: "#89b4fa", key: "#eba0ac", cmt: "#9399b2", punc: "#9399b2" }),
  },
  "tokyo-night": {
    light: side("light", { kw: "#9854f1", str: "#587539", num: "#b15c00", lit: "#b15c00", typ: "#188092", fn: "#2e7de9", key: "#8c6c3e", cmt: "#848cb5", punc: "#6172b0" }),
    dark: side("dark", { kw: "#bb9af7", str: "#9ece6a", num: "#ff9e64", lit: "#ff9e64", typ: "#2ac3de", fn: "#7aa2f7", key: "#e0af68", cmt: "#565f89", punc: "#89ddff" }),
  },
  nimbo: null,
} as const satisfies Readonly<Record<string, SyntaxTheme | null>>;

export type SyntaxThemeId = keyof typeof syntaxThemes;
