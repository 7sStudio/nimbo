// Stream text → styled spans ("ANSI rendered"): SGR colors and styles, OSC 8 links, every other
// escape dropped, `\r` overwriting the line as a terminal does. No HTML here: the view or the export escapes the text.

/** A palette index (0–15 the named colors, 16–255 xterm's cube and greys) or a 24-bit color. */
export type AnsiColor =
  { readonly index: number } | { readonly rgb: readonly [number, number, number] };

/** A full style; `null` colors are the stream's own. */
export type AnsiStyle = {
  readonly fg: AnsiColor | null;
  readonly bg: AnsiColor | null;
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly inverse: boolean;
  readonly hidden: boolean;
  readonly strike: boolean;
};

/** A run of text in one style; `link` is the http(s) target of an OSC 8 hyperlink around it. */
export type Span = { readonly text: string; readonly style: AnsiStyle; readonly link?: string };

export const plainStyle: AnsiStyle = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  hidden: false,
  strike: false,
};

const esc = String.fromCharCode(27);
const bel = String.fromCharCode(7);
// CSI (ESC [ params intermediates final), OSC (ESC ] body, then BEL or ESC \), then any two-character escape.
const escapes = new RegExp(
  `${esc}\\[([0-9;:?]*)[ -/]*([@-~])|${esc}\\]([^${bel}${esc}]*)(?:${bel}|${esc}\\\\)?|${esc}[@-_]?`,
  "g",
);

const patches: Readonly<Record<number, Partial<AnsiStyle>>> = {
  1: { bold: true },
  2: { dim: true },
  3: { italic: true },
  4: { underline: true },
  7: { inverse: true },
  8: { hidden: true },
  9: { strike: true },
  21: { underline: true },
  22: { bold: false, dim: false },
  23: { italic: false },
  24: { underline: false },
  27: { inverse: false },
  28: { hidden: false },
  29: { strike: false },
  39: { fg: null },
  49: { bg: null },
};

/** 30–37 and 90–97 set the foreground, 40–47 and 100–107 the background, to one of the sixteen named colors. */
function colorPatch(code: number): Partial<AnsiStyle> | undefined {
  const bright = code >= 90;
  const base = bright ? code - 60 : code;
  const index = (base % 10) + (bright ? 8 : 0);
  if (base >= 30 && base <= 37) return { fg: { index } };
  return base >= 40 && base <= 47 ? { bg: { index } } : undefined;
}

const byte = (value: number | undefined): number => Math.min(255, Math.max(0, value ?? 0));

/** `38;5;n` / `38;2;r;g;b` after the 38 or 48 at `at - 1`: the color and the last code it used. */
function extended(
  codes: readonly number[],
  at: number,
): { color: AnsiColor; end: number } | undefined {
  if (codes[at] === 5) return { color: { index: byte(codes[at + 1]) }, end: at + 1 };
  if (codes[at] !== 2) return undefined;
  const rgb = [byte(codes[at + 1]), byte(codes[at + 2]), byte(codes[at + 3])] as const;
  return { color: { rgb }, end: at + 3 };
}

type Step = { readonly style: AnsiStyle; readonly next: number };

function stepColor(style: AnsiStyle, codes: readonly number[], at: number): Step {
  const color = extended(codes, at + 1);
  if (color === undefined) return { style, next: codes.length };
  const patch = codes[at] === 38 ? { fg: color.color } : { bg: color.color };
  return { style: { ...style, ...patch }, next: color.end + 1 };
}

function step(style: AnsiStyle, codes: readonly number[], at: number): Step {
  const code = codes[at] ?? 0;
  if (code === 38 || code === 48) return stepColor(style, codes, at);
  if (code === 0) return { style: plainStyle, next: at + 1 };
  return { style: { ...style, ...(patches[code] ?? colorPatch(code)) }, next: at + 1 };
}

/** The style after one SGR sequence's parameters (`1;31`, `38;5;208`, empty for a reset). */
function applySgr(style: AnsiStyle, params: string): AnsiStyle {
  const codes = params === "" ? [0] : params.split(/[;:]/).map((part) => Number(part || "0"));
  let current: Step = { style, next: 0 };
  while (current.next < codes.length) current = step(current.style, codes, current.next);
  return current.style;
}

/** The target of an OSC 8 hyperlink body (`8;params;uri`); undefined when it ends a link or is not http(s). */
const linkOf = (body: string): string | undefined => {
  const uri = body.slice(body.indexOf(";", 2) + 1);
  return /^https?:\/\//i.test(uri) ? uri : undefined;
};

const span = (text: string, style: AnsiStyle, link: string | undefined): Span =>
  link === undefined ? { text, style } : { text, style, link };

/** The styled spans of a stream's text; escapes other than SGR and OSC 8 are dropped. */
export function parseAnsi(text: string): Span[] {
  const spans: Span[] = [];
  let style = plainStyle;
  let link: string | undefined;
  let last = 0;
  escapes.lastIndex = 0;
  for (let match = escapes.exec(text); match; match = escapes.exec(text)) {
    if (match.index > last) spans.push(span(text.slice(last, match.index), style, link));
    last = match.index + match[0].length;
    const osc = match[3];
    if (match[2] === "m") style = applySgr(style, match[1] ?? "");
    else if (osc?.startsWith("8;")) link = linkOf(osc);
  }
  if (text.length > last) spans.push(span(text.slice(last), style, link));
  return spans;
}

/** The text without any escape sequence. */
export const stripAnsi = (text: string): string => text.replace(escapes, "");

/**
 * The lines a terminal would show: split on `\n`, a final `\n` ending the last line rather than starting an empty one
 * (kernel streams end in one), and within a line the text after its last `\r` (a progress bar). No text, no lines.
 */
export function streamLines(text: string): string[] {
  if (text === "") return [];
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.split("\n").map((line) => {
    const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
    return trimmed.slice(trimmed.lastIndexOf("\r") + 1);
  });
}

const named: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [205, 49, 49],
  [13, 188, 121],
  [229, 229, 16],
  [36, 114, 200],
  [188, 63, 188],
  [17, 168, 205],
  [229, 229, 229],
  [102, 102, 102],
  [241, 76, 76],
  [35, 209, 139],
  [245, 245, 67],
  [59, 142, 234],
  [214, 112, 214],
  [41, 184, 219],
  [229, 229, 229],
];

const cube = [0, 95, 135, 175, 215, 255];

/** The RGB of a color: the sixteen named colors as VS Code's terminal draws them, xterm's cube and grey ramp above. */
export function ansiRgb(color: AnsiColor): readonly [number, number, number] {
  if ("rgb" in color) return color.rgb;
  const index = byte(color.index);
  const base = named[index];
  if (base) return base;
  if (index >= 232) return [8 + (index - 232) * 10, 8 + (index - 232) * 10, 8 + (index - 232) * 10];
  const cell = index - 16;
  const level = (n: number): number => cube[n] ?? 0;
  return [level(Math.floor(cell / 36)), level(Math.floor(cell / 6) % 6), level(cell % 6)];
}
