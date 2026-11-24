// Tests palette.ts: every color's oklch() and its hex figure are the same sRGB color within one 8-bit step per channel
// in both themes (the comparison output-view's theme test made before the palette moved here), every name is defined
// once, and hex() follows an alias to the color it names.
import { describe, expect, it } from "vitest";

import { channels, oklchChannels } from "./fixtures/oklch.js";
import type { ColorName, Theme } from "./palette.js";
import { colorGroups, colors, hex } from "./palette.js";
import { valueGroups } from "./values.js";

const themes: readonly Theme[] = ["light", "dark"];
const own = Object.entries(colors).flatMap(([name, color]) =>
  "of" in color ? [] : themes.map((theme) => [name, theme, color[theme]] as const),
);

const distance = (oklch: string, figure: string): number => {
  const rgb = oklchChannels(oklch);
  return Math.max(...channels(figure).map((channel, i) => Math.abs(channel - (rgb[i] ?? -999))));
};

describe("the palette", () => {
  it.each(own)("--%s in %s: its oklch() is its hex within 1 per channel", (_, __, shade) => {
    expect(shade.hex).toMatch(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/u);
    expect(distance(shade.oklch, shade.hex)).toBeLessThanOrEqual(1);
  });

  it("holds each name once, colors and values together, in groups that hold every color", () => {
    const grouped = colorGroups.flatMap((group) => Object.keys(group.colors));
    const values = valueGroups.flatMap((group) => Object.keys(group.values));
    expect(new Set([...grouped, ...values]).size).toBe(grouped.length + values.length);
    expect(grouped).toEqual(Object.keys(colors));
  });

  it("gives an alias the figure of the color it names, in both themes", () => {
    const pairs: readonly (readonly [ColorName, ColorName])[] = [
      ["warn", "hot"],
      ["chip", "fg"],
      ["bool", "kw"],
      ["nul", "cmt"],
      ["punc", "fg-2"],
    ];
    for (const theme of themes) {
      expect(pairs.map(([alias]) => hex(alias, theme))).toEqual(
        pairs.map(([, target]) => hex(target, theme)),
      );
    }
    expect([hex("result", "light"), hex("result", "dark")]).toEqual(["#f5f4f1", "#18191c"]);
  });

  it("keeps dark --faint a step lighter than the design's #757983, its hex the lighter one's", () => {
    expect([hex("faint", "light"), hex("faint", "dark")]).toEqual(["#7e8189", "#828690"]);
  });
});
