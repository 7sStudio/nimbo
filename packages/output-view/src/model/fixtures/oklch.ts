// OKLCH ↔ sRGB for the palette and theme tests (Björn Ottosson's matrices): theme.css's oklch() values read back as
// 8-bit channels, and the move along OKLCH lightness that brings an ANSI color to 4.5:1 on a background.

const gamma = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

const byte = (c: number): number => Math.round(Math.min(1, Math.max(0, gamma(c))) * 255);

const linear = (byteValue: number): number => {
  const c = byteValue / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** The 8-bit channels of `#rrggbb`. */
export const channels = (hex: string): number[] => {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

const hexOf = (rgb: readonly number[]): string =>
  `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;

/** `oklch(L% C h)` → [r, g, b] in 0–255, clipped to the sRGB gamut. */
function oklchToRgb(lightness: number, chroma: number, hue: number): [number, number, number] {
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    byte(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    byte(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    byte(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** `#rrggbb` → [L (0–1), C, h in degrees]. */
function rgbToOklch(hex: string): [number, number, number] {
  const [r = 0, g = 0, b = 0] = channels(hex).map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const hue = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, Math.hypot(a, bb), hue];
}

/**
 * `color` as it is when `contrastOf(color)` reaches `ratio`, else moved along its OKLCH lightness (chroma and hue
 * kept) in steps of 0.1 %, darker when `darker`, to the first 8-bit color that reaches it.
 */
export function towardContrast(
  color: string,
  contrastOf: (hex: string) => number,
  { ratio, darker }: { readonly ratio: number; readonly darker: boolean },
): string {
  const [lightness, chroma, hue] = rgbToOklch(color);
  let moved = color;
  for (let step = 0; contrastOf(moved) < ratio && step < 1000; step += 1) {
    const next = lightness + ((darker ? -1 : 1) * (step + 1)) / 1000;
    moved = hexOf(oklchToRgb(next, chroma, hue));
  }
  return moved;
}

/** The `light-dark(oklch(…), oklch(…))` declarations of a stylesheet, by custom property name. */
export function lightDarkTokens(css: string): Map<string, { light: number[]; dark: number[] }> {
  const pattern =
    /--([a-z0-9-]+):\s*light-dark\(\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\),\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)\s*\)/g;
  const tokens = new Map<string, { light: number[]; dark: number[] }>();
  for (const match of css.matchAll(pattern)) {
    const n = match.slice(2).map(Number);
    const [l1 = 0, c1 = 0, h1 = 0, l2 = 0, c2 = 0, h2 = 0] = n;
    tokens.set(match[1] ?? "", {
      light: oklchToRgb(l1 / 100, c1, h1),
      dark: oklchToRgb(l2 / 100, c2, h2),
    });
  }
  return tokens;
}
