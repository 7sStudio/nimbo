// OKLCH → sRGB for the palette test: a Shade's oklch() arguments read back as 8-bit channels (Björn Ottosson's matrices),
// so they can be held against its hex figure.

const gamma = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

const byte = (c: number): number => Math.round(Math.min(1, Math.max(0, gamma(c))) * 255);

/** The 8-bit channels of `#rrggbb` or `#rrggbbaa`, the alpha 255 when the hex has none. */
export const channels = (hex: string): number[] => {
  const pairs = hex.slice(1).match(/../gu) ?? [];
  const [r = 0, g = 0, b = 0, a = 255] = pairs.map((pair) => Number.parseInt(pair, 16));
  return [r, g, b, a];
};

/** `L% C h` or `L% C h / a%` → [r, g, b, a] in 0–255, clipped to the sRGB gamut. */
export function oklchChannels(oklch: string): number[] {
  const match = /^([\d.]+)%\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)%)?$/u.exec(oklch);
  const [, lightness = "0", chroma = "0", hue = "0", alpha = "100"] = match ?? [];
  const L = Number(lightness) / 100;
  const a = Number(chroma) * Math.cos((Number(hue) * Math.PI) / 180);
  const b = Number(chroma) * Math.sin((Number(hue) * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    byte(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    byte(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    byte(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    Math.round((Number(alpha) / 100) * 255),
  ];
}
