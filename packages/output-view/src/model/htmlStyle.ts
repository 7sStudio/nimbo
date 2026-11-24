// The stylesheet of the HTML export: palette.ts as custom properties for both themes and the viewer's tree, grid,
// stream and error looks, so the exported page reads like the output it came from. Sizes are the
// viewer's type at the page's 16 px root (12 px interface, 13 px values, 11 px meta), corners square as the page's
// are; px only for the 1 px rule under the grid's header row.
import type { ThemeName } from "./palette.js";
import { ansiPalettes, palettes, syntaxTokens } from "./palette.js";

/** A theme's tokens and its sixteen named ANSI colors (--ansi-0 … --ansi-15), as the viewer's theme.css has them. */
const variables = (theme: ThemeName): string =>
  [
    ...Object.entries(palettes[theme]).map(([name, value]) => `--${name}:${value}`),
    ...ansiPalettes[theme].map((value, index) => `--ansi-${String(index)}:${value}`),
  ].join(";");

const tokenRules = [...syntaxTokens, "text"]
  .map((token) => `[data-token=${token}]{color:var(--${token === "text" ? "fg" : token})}`)
  .join("");

const rules = [
  ":root{color-scheme:light;background:var(--bg);color:var(--fg)}",
  ":root[data-theme=dark]{color-scheme:dark}",
  "body{margin:0;font:0.75rem/1.45 Geist,system-ui,sans-serif;background:var(--bg);color:var(--fg)}",
  "main{padding:1rem 1.25rem;display:grid;gap:0.75rem}",
  "header{display:flex;gap:0.75rem;align-items:baseline;color:var(--muted);font-size:0.6875rem}",
  "[data-part=summary-name]{font:600 0.75rem 'JetBrains Mono',ui-monospace,monospace;color:var(--fg)}",
  "[data-part=value],pre,table{font:0.8125rem/1.6 'JetBrains Mono',ui-monospace,monospace}",
  "[data-part=children]{padding-inline-start:1.125rem}",
  "summary{cursor:pointer;list-style-position:outside}",
  "[data-part=row]{white-space:pre-wrap;padding-inline-start:0.125rem}",
  "[data-part=count]{color:var(--muted);font-size:0.6875rem;margin-inline-start:0.375rem}",
  "[data-part=hint]{color:var(--muted);font-size:0.6875rem;margin-inline-start:0.5rem}",
  "table{border-collapse:separate;border-spacing:0}",
  "th{position:sticky;inset-block-start:0;text-align:start;font:500 0.75rem Geist,system-ui,sans-serif;color:var(--fg-2);background:var(--bg);padding:0.3125rem 0.625rem;border-block-end:1px solid var(--border)}",
  "td{padding:0.25rem 0.625rem;white-space:nowrap;font-variant-numeric:tabular-nums}",
  "pre{margin:0;white-space:pre-wrap}",
  "[data-stream=stderr]{color:var(--err)}",
  "[data-part=frames]{margin:0;padding-inline-start:1.125rem;color:var(--fg-2)}",
  "iframe{inline-size:100%;min-block-size:15rem;border:0;background:transparent}",
  "img{max-inline-size:100%}",
  tokenRules,
];

/** The export page's CSS: light by default, dark under `prefers-color-scheme` unless the page pins a theme. */
export const exportStyle = (): string =>
  [
    `:root{${variables("light")}}`,
    `@media (prefers-color-scheme:dark){:root:not([data-theme=light]){color-scheme:dark;${variables("dark")}}}`,
    `:root[data-theme=dark]{${variables("dark")}}`,
    ...rules,
  ].join("\n");
