// The HTML export: one self-contained page built from the model with the viewer's look; a strict
// Content-Security-Policy and sandboxed frames for user HTML keep anything in the page from running.
import type { ErrorInfo } from "@jsnb/core";

import { ansiRgb, parseAnsi } from "./ansi.js";
import type { AnsiColor, AnsiStyle, Span } from "./ansi.js";
import { detect, displayJson } from "./detect.js";
import { errorModel, frameWords } from "./frames.js";
import { frameDoc } from "./frameDoc.js";
import { exportStyle } from "./htmlStyle.js";
import type { ValueHtmlOptions } from "./htmlValue.js";
import { escapeHtml, gridHtml, treeHtml } from "./htmlValue.js";
import type { ViewInput } from "./output.js";
import { gridOf } from "./records.js";
import { summarize, summaryParts } from "./summary.js";

/** `title`: the page title (default "Output"); `theme` pins one theme, else the reader's preference applies. */
export type HtmlOptions = ValueHtmlOptions & {
  readonly title?: string;
  readonly theme?: "light" | "dark";
};

export const csp =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; frame-src 'self'";

/** A color as the page paints it: a named one (0–15) as the theme's --ansi-N (htmlStyle.ts, the viewer's palette at
 * 4.5:1, palette.ts ansiPalettes), any other as the stream gives it. */
const rgb = (color: AnsiColor | null): string | undefined => {
  if (color === null) return undefined;
  if ("index" in color && color.index < 16) return `var(--ansi-${String(color.index)})`;
  const [r, g, b] = ansiRgb(color);
  return `rgb(${String(r)} ${String(g)} ${String(b)})`;
};

const flagRules: readonly (readonly ["bold" | "dim" | "italic" | "hidden", string])[] = [
  ["bold", "font-weight:600"],
  ["dim", "opacity:.7"],
  ["italic", "font-style:italic"],
  ["hidden", "visibility:hidden"],
];

/** The inline CSS of an ANSI style (the export has no stylesheet entry per palette index). */
function styleCss(style: AnsiStyle): string[] {
  const fg = rgb(style.inverse ? style.bg : style.fg);
  const bg = rgb(style.inverse ? style.fg : style.bg);
  const lines = [style.underline ? "underline" : "", style.strike ? "line-through" : ""].filter(
    Boolean,
  );
  const css = [
    fg === undefined ? "" : `color:${fg}`,
    bg === undefined ? "" : `background:${bg}`,
    lines.length === 0 ? "" : `text-decoration:${lines.join(" ")}`,
    ...flagRules.map(([flag, rule]) => (style[flag] ? rule : "")),
  ];
  return css.filter((rule) => rule !== "");
}

function spanHtml(span: Span): string {
  const css = styleCss(span.style);
  const text = escapeHtml(span.text);
  const body = css.length === 0 ? text : `<span style="${css.join(";")}">${text}</span>`;
  return span.link === undefined ? body : `<a href="${escapeHtml(span.link)}">${body}</a>`;
}

function errorHtml(error: ErrorInfo, options: HtmlOptions): string {
  const model = errorModel(error);
  const frames = model.groups.map((group) =>
    group.kind === "internal"
      ? `<li>${String(group.frames.length)} internal Node frames</li>`
      : `<li>${escapeHtml(frameWords(group.frame))}</li>`,
  );
  const causes = model.causes.map(
    (cause) =>
      `<p>caused by <span data-token="typ">${escapeHtml(cause.name)}</span>: ${escapeHtml(cause.message)}</p>`,
  );
  const data = model.data === undefined ? "" : treeHtml(model.data, options);
  return `<p><span data-token="typ">${escapeHtml(model.name)}</span>: ${escapeHtml(model.message)}</p><ul data-part="frames">${frames.join("")}</ul>${causes.join("")}${data}<details><summary>Raw stack</summary><pre>${escapeHtml(error.raw)}</pre></details>`;
}

/** Image data as an `src`: a data URL or an https URL as given, SVG markup as a data URL, else base64 of the mime. */
const imageSrc = (mime: string, data: string): string => {
  if (/^(data:image\/|https:\/\/)/i.test(data)) return data;
  if (mime === "image/svg+xml" && data.trimStart().startsWith("<"))
    return `data:${mime};charset=utf-8,${encodeURIComponent(data)}`;
  return `data:${mime};base64,${data}`;
};

const frame = (html: string): string =>
  `<iframe sandbox="" title="HTML output" srcdoc="${escapeHtml(frameDoc(html))}"></iframe>`;

function valueHtml(json: unknown, options: HtmlOptions): string {
  const grid = gridOf(json);
  return grid ? gridHtml(grid, options) : treeHtml(json, options);
}

function displayHtml(
  input: ViewInput & { readonly kind: "display" },
  options: HtmlOptions,
): string {
  const parsed = displayJson(input);
  if (parsed !== undefined) return valueHtml(parsed.json, options);
  if (detect(input) !== "display") return `<pre>${escapeHtml(input.data)}</pre>`;
  if (input.mime === "text/html") return frame(input.data);
  return `<img alt="${escapeHtml(input.mime)} output" src="${escapeHtml(imageSrc(input.mime, input.data))}">`;
}

/** One output's body as the export page draws it (also the notebook page's, notebookHtml.ts). */
export function bodyHtml(input: ViewInput, options: HtmlOptions): string {
  switch (input.kind) {
    case "value":
      return valueHtml(input.json, options);
    case "stream":
      return `<pre data-stream="${input.stream}">${parseAnsi(input.text).map(spanHtml).join("")}</pre>`;
    case "error":
      return errorHtml(input.error, options);
    case "display":
      return displayHtml(input, options);
    case "dom":
      return `${frame(input.html)}<pre>${escapeHtml(input.text)}</pre>`;
    case "event":
      return `<p><span data-token="typ">${escapeHtml(input.name)}</span> <span data-token="nul">${escapeHtml(input.at)}</span></p>${treeHtml(input.data, options)}`;
  }
}

/** The output as a self-contained HTML page: inline styles from the palette, no script, no network, both themes. */
export function toHTML(input: ViewInput, options: HtmlOptions = {}): string {
  const summary = summarize(input);
  const theme = options.theme === undefined ? "" : ` data-theme="${options.theme}"`;
  const title = escapeHtml(options.title ?? "Output");
  const parts = summaryParts(summary);
  const header = `<header><b data-part="summary-name">${escapeHtml(summary.name)}</b>${parts === "" ? "" : `<span>${escapeHtml(parts)}</span>`}</header>`;
  return `<!doctype html>\n<html lang="en"${theme}><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${exportStyle()}</style></head><body><main class="jsnb-ov">${header}${bodyHtml(input, options)}</main></body></html>\n`;
}
