// Tests src/theme.css: it takes the shared tokens from @jsnb/tokens, declares the viewer's own names on the shared tones
// exactly as palette.ts's viewerTones says, its ANSI oklch() colors compile to palette.ts's hex within one 8-bit step per
// channel, and the stylesheet stays scoped under .jsnb-ov.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { channels, lightDarkTokens } from "./fixtures/oklch.js";
import { ansiPalettes, surfaceTokens, syntaxTokens, viewerTones } from "./palette.js";

const css = readFileSync(new URL("../theme.css", import.meta.url), "utf8");
const tokens = lightDarkTokens(css);
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

const distance = (rgb: readonly number[], hex: string): number =>
  Math.max(...channels(hex).map((channel, i) => Math.abs(channel - (rgb[i] ?? -999))));

/** The `--name: var(--other);` declarations of theme.css, by name. */
const mapped = new Map(
  [...code.matchAll(/--([a-z0-9-]+):\s*var\(--([a-z0-9-]+)\);/g)].map((m) => [m[1], m[2]]),
);

describe("theme.css", () => {
  it("imports the shared tokens before anything of its own", () => {
    expect(code.trimStart()).toMatch(
      /^@layer [^;]+;\s*@import "@jsnb\/tokens\/viewer\.css";\s*@layer tokens \{/,
    );
  });

  it("maps each of the viewer's own names onto its shared tone, and redeclares no shared one", () => {
    const names = [...surfaceTokens, ...syntaxTokens];
    const own = names.filter((token) => viewerTones[token] !== token);
    expect(own.map((token) => [token, mapped.get(token)])).toEqual(
      own.map((token) => [token, viewerTones[token]]),
    );
    expect(names.filter((token) => viewerTones[token] === token && mapped.has(token))).toEqual([]);
  });

  it.each(ansiPalettes.light.map((_, index) => index))(
    "--ansi-%d matches the ANSI palette within 1 per channel in both themes",
    (index) => {
      const token = tokens.get(`ansi-${String(index)}`);
      expect(distance(token?.light ?? [], ansiPalettes.light[index] ?? "")).toBeLessThanOrEqual(1);
      expect(distance(token?.dark ?? [], ansiPalettes.dark[index] ?? "")).toBeLessThanOrEqual(1);
    },
  );

  it("holds no color literal but the ANSI colors", () => {
    expect([...tokens.keys()].filter((name) => !name.startsWith("ansi-"))).toEqual([]);
    expect(code.match(/oklch\(/g)).toHaveLength(32);
  });

  it("styles nothing outside .jsnb-ov", () => {
    const selectors = [...code.matchAll(/([^{};]+)\{/g)]
      .map((m) => (m[1] ?? "").trim())
      .filter((s) => !s.startsWith("@") && s !== "");
    expect(selectors.filter((selector) => !selector.startsWith(".jsnb-ov"))).toEqual([]);
  });

  it("pins a theme through data-theme and defines the search highlight", () => {
    expect(css).toMatch(/\.jsnb-ov\[data-theme="dark"\]\s*\{\s*color-scheme: dark;/);
    expect(css).toMatch(/--match: color-mix\(in oklch, var\(--warn\) 30%, transparent\);/);
  });
});
