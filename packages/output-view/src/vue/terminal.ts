// How a stream reads: its lines as a terminal shows them (\r rewrites a line), each in styled runs
// from its ANSI escapes, with the attributes and color properties a run needs and its OSC 8 link.
import type { AnsiColor, AnsiStyle, Span } from "../model/ansi.js";
import { ansiRgb, parseAnsi, streamLines } from "../model/ansi.js";

/** Lines shown from the end of a long stream until "Show all". */
export const tailLines = 2000;

/** A named color (0–15) as the theme's --ansi-N, at 4.5:1 on --bg (palette.ts); any other as the stream gives it. */
const css = (color: AnsiColor): string =>
  "index" in color && color.index < 16
    ? `var(--ansi-${String(color.index)})`
    : `rgb(${ansiRgb(color).join(" ")})`;

/** The flags a run carries as data- attributes, which StreamView's stylesheet draws (no inline styles). */
const flags: readonly (keyof AnsiStyle &
  ("bold" | "dim" | "italic" | "underline" | "strike" | "hidden"))[] = [
  "bold",
  "dim",
  "italic",
  "underline",
  "strike",
  "hidden",
];

/** A color as a custom property: the run's color, the theme's opposite one when inverse swapped in a default. */
const paint = (
  property: "--run-fg" | "--run-bg",
  color: AnsiColor | null,
  inverse: boolean,
  swapped: string,
): Record<string, string> => {
  if (color) return { [property]: css(color) };
  return inverse ? { [property]: swapped } : {};
};

/**
 * A run's attributes: `data-fg` and `data-bg` with their colors in the custom properties `--run-fg` and `--run-bg`
 * (computed at runtime, the only inline style allowed), swapped when inverse, and one data- attribute per flag.
 */
export function runAttrs(span: Span): Record<string, unknown> {
  const { style } = span;
  const colors = {
    ...paint("--run-fg", style.inverse ? style.bg : style.fg, style.inverse, "var(--bg)"),
    ...paint("--run-bg", style.inverse ? style.fg : style.bg, style.inverse, "var(--fg)"),
  };
  const attrs: Record<string, unknown> = {
    style: Object.keys(colors).length > 0 ? colors : undefined,
    "data-fg": "--run-fg" in colors ? "" : undefined,
    "data-bg": "--run-bg" in colors ? "" : undefined,
  };
  for (const flag of flags) attrs[`data-${flag}`] = style[flag] ? "" : undefined;
  return attrs;
}

/** A run and the offset it starts at in its line, the run's stable key. */
export type Run = { readonly span: Span; readonly start: number };

/** The stream's lines as styled runs, the last `limit` of them unless all are asked for. */
export function styledLines(text: string, limit: number | undefined): Run[][] {
  const lines = streamLines(text);
  const kept = limit === undefined ? lines : lines.slice(-limit);
  return kept.map((line) => {
    let start = 0;
    return parseAnsi(line).map((span) => {
      const run = { span, start };
      start += span.text.length;
      return run;
    });
  });
}

/** How many lines a stream has, as the summary and styledLines count them. */
export const lineCount = (text: string): number => streamLines(text).length;
