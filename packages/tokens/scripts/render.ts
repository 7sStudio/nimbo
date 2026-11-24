// Renders one token stylesheet: every color of the palette and every shared value as a custom property under one
// selector, in the tokens layer, group by group with each group's note as its comment.
import type { Color, Shade } from "../src/index.js";
import { colorGroups, valueGroups } from "../src/index.js";

/** A stylesheet the package ships: its file under src/, the selector its tokens sit on, and who it is for. */
export type Sheet = { readonly file: string; readonly selector: string; readonly purpose: string };

const oklch = (shade: Shade): string => `oklch(${shade.oklch})`;

/** A color as CSS: another token's, one oklch() for both themes, or light-dark() of the two. */
const value = (color: Color): string => {
  if ("of" in color) return `var(--${color.of})`;
  if (color.light.oklch === color.dark.oklch) return oklch(color.light);
  return `light-dark(${oklch(color.light)}, ${oklch(color.dark)})`;
};

const groups = (): readonly { readonly note: string; readonly lines: readonly string[] }[] => [
  ...colorGroups.map(({ note, colors }) => ({
    note,
    lines: Object.entries(colors).map(([name, color]) => `--${name}: ${value(color)};`),
  })),
  ...valueGroups.map(({ note, values }) => ({
    note,
    lines: Object.entries(values).map(([name, css]) => `--${name}: ${css};`),
  })),
];

/** The text of `sheet` before Prettier: a head comment, then one rule in the tokens layer. */
export function renderSheet(sheet: Sheet): string {
  const body = groups()
    .map(({ note, lines }) => [`/* ${note} */`, ...lines].map((line) => `    ${line}`).join("\n"))
    .join("\n\n");
  return [
    `/* The shared tokens of @jsnb/tokens ${sheet.purpose}.`,
    `   Written by scripts/generate.ts from src/palette.ts and src/values.ts: change those, then run`,
    `   \`pnpm --filter @jsnb/tokens generate\`; a test fails while this file differs. */`,
    `@layer tokens {`,
    `  ${sheet.selector} {`,
    body,
    `  }`,
    `}`,
    ``,
  ].join("\n");
}
