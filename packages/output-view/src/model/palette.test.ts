// Tests palette.ts: every syntax token reaches 4.5:1 on the viewer background, the shared result tone, in both themes;
// every color is @jsnb/tokens' through the viewer's names; and the named ANSI colors are VS Code's,
// each moved to 4.5:1 on that background where it fell short, and reach it.
import { hex } from "@jsnb/tokens";
import { describe, expect, it } from "vitest";

import { towardContrast } from "./fixtures/oklch.js";
import type { ThemeName } from "./palette.js";
import {
  ansiPalettes,
  contrast,
  luminance,
  minimumContrast,
  palettes,
  surfaceTokens,
  syntaxTokens,
  viewerBackground,
  viewerTones,
} from "./palette.js";

const themes: readonly ThemeName[] = ["light", "dark"];
const pairs = themes.flatMap((theme) => syntaxTokens.map((token) => [theme, token] as const));

/** VS Code's terminal colors 0–15, Light+ and Dark+ (terminalColorRegistry), before any contrast adjustment. */
const vsCode: Readonly<Record<ThemeName, readonly string[]>> = {
  light: [
    ...["#000000", "#cd3131", "#00bc00", "#949800", "#0451a5", "#bc05bc", "#0598bc", "#555555"],
    ...["#666666", "#cd3131", "#14ce14", "#b5ba00", "#0451a5", "#bc05bc", "#0598bc", "#a5a5a5"],
  ],
  dark: [
    ...["#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5"],
    ...["#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#e5e5e5"],
  ],
};

describe("palettes", () => {
  it.each(pairs)("%s --%s reaches 4.5:1 on the viewer background", (theme, token) => {
    expect(
      contrast(palettes[theme][token], palettes[theme][viewerBackground]),
    ).toBeGreaterThanOrEqual(minimumContrast);
  });

  it.each(themes)("%s is the shared palette through the viewer's names", (theme) => {
    const names = [...surfaceTokens, ...syntaxTokens];
    expect(names.map((token) => [token, palettes[theme][token]])).toEqual(
      names.map((token) => [token, hex(viewerTones[token], theme)]),
    );
  });

  it("paints a result on the shared result tone, its surfaces the code's white, the header and the well", () => {
    expect([palettes.light.bg, palettes.light.surface, palettes.light["surface-2"]]).toEqual([
      "#f5f4f1",
      "#ffffff",
      "#eceae6",
    ]);
    expect([palettes.dark.bg, palettes.dark.surface, palettes.dark["surface-3"]]).toEqual([
      "#18191c",
      "#212328",
      "#2e3036",
    ]);
  });

  it("takes the editor's syntax colors: booleans are keywords, punctuation the second ink", () => {
    expect([palettes.light.bool, palettes.light.punc]).toEqual([hex("kw", "light"), "#44474f"]);
    expect([palettes.dark.bool, palettes.dark.punc]).toEqual([hex("kw", "dark"), "#bcbfc6"]);
  });
});

describe("ANSI palettes", () => {
  it.each(themes)(
    "%s gives sixteen named colors, each at 4.5:1 or more on the viewer background",
    (theme) => {
      const background = palettes[theme][viewerBackground];
      expect(ansiPalettes[theme]).toHaveLength(16);
      expect(
        ansiPalettes[theme].filter((color) => contrast(color, background) < minimumContrast),
      ).toEqual([]);
    },
  );

  it.each(themes)(
    "%s is VS Code's, each moved along its lightness only as far as 4.5:1",
    (theme) => {
      const background = palettes[theme][viewerBackground];
      const options = { ratio: minimumContrast, darker: luminance(background) > 0.18 };
      const derived = vsCode[theme].map((color) =>
        towardContrast(color, (moved) => contrast(moved, background), options),
      );
      expect(ansiPalettes[theme]).toEqual(derived);
    },
  );

  it("derives the colors it had on the old #ffffff and #0b0d12 backgrounds the same way", () => {
    const on = (background: string, color: string, darker: boolean) =>
      towardContrast(color, (moved) => contrast(moved, background), { ratio: 4.5, darker });
    expect(["#00bc00", "#949800", "#a5a5a5"].map((color) => on("#ffffff", color, true))).toEqual([
      "#008a00",
      "#787b00",
      "#767676",
    ]);
    expect(["#000000", "#cd3131", "#2472c8"].map((color) => on("#0b0d12", color, false))).toEqual([
      "#7a7a7a",
      "#dc413e",
      "#2e7bd1",
    ]);
  });
});

describe("contrast", () => {
  it("runs from 1 for one color to 21 for black on white", () => {
    expect([
      contrast("#000000", "#ffffff"),
      contrast("#ffffff", "#000000"),
      contrast("#6d5df0", "#6d5df0"),
    ]).toEqual([21, 21, 1]);
    expect([luminance("#ffffff"), luminance("#000000")]).toEqual([1, 0]);
  });
});
