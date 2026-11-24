// The notebook's HTML export (07-file-format §9, notebook.export): one self-contained page with every cell in order,
// markdown rendered by the host's renderer, code as text, and each cell's last outputs drawn as the output export draws
// one (html.ts). The same strict Content-Security-Policy: no script runs, user HTML stays in sandboxed frames.
import type { ErrorInfo, Output } from "@jsnb/core";

import type { HtmlOptions } from "./html.js";
import { bodyHtml, csp } from "./html.js";
import { exportStyle } from "./htmlStyle.js";
import { escapeHtml } from "./htmlValue.js";

export type NotebookHtmlCell = {
  readonly id: string;
  readonly type: "server" | "client" | "markdown";
  readonly source: string;
  /** The cell's name, shown in its header (a title, or what the cell defines). */
  readonly name?: string;
  /** The last run's outputs; absent when the cell never ran or outputs are left out. */
  readonly outputs?: readonly Output[];
  /** The run's error when no error output carries it (a run that failed before printing). */
  readonly error?: ErrorInfo;
  readonly status?: string;
  readonly durationMs?: number;
};

export type NotebookHtmlOptions = Omit<HtmlOptions, "title"> & {
  readonly title: string;
  /** Markdown to HTML; the page's CSP keeps any script in it from running. */
  readonly markdown: (source: string) => string;
};

const notebookRules = [
  "main.jsnb-nb{max-inline-size:60rem;margin-inline:auto;gap:1rem;padding-block:2rem}",
  "h1.jsnb-title{font:600 1.25rem Geist,system-ui,sans-serif;margin:0 0 0.5rem}",
  "section[data-cell]{display:grid;gap:0.375rem}",
  "section[data-cell] > header{font:500 0.6875rem 'JetBrains Mono',ui-monospace,monospace;color:var(--muted)}",
  "pre.jsnb-src{padding:0.625rem 0.75rem;border:1px solid var(--border);border-radius:0.375rem;background:var(--bg-2,transparent);overflow-x:auto;white-space:pre}",
  "div.jsnb-out{display:grid;gap:0.375rem;padding-inline:1.25rem;overflow-x:auto}",
  ".jsnb-md{font:0.875rem/1.6 Geist,system-ui,sans-serif}",
  ".jsnb-md :is(h1,h2,h3){margin:0.75rem 0 0.25rem}",
  ".jsnb-md code{font-family:'JetBrains Mono',ui-monospace,monospace}",
  ".jsnb-md pre{padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:0.375rem}",
];

function outputsHtml(cell: NotebookHtmlCell, options: HtmlOptions): string {
  const outputs = cell.outputs ?? [];
  const parts = outputs.map((output) => bodyHtml(output, options));
  const hasError = outputs.some((output) => output.kind === "error");
  if (cell.error !== undefined && !hasError)
    parts.push(bodyHtml({ kind: "error", error: cell.error }, options));
  return parts.length === 0 ? "" : `<div class="jsnb-out">${parts.join("")}</div>`;
}

function headerOf(cell: NotebookHtmlCell): string {
  const facts = [
    cell.type,
    cell.name,
    cell.status === undefined || cell.status === "ok" ? undefined : cell.status,
    cell.durationMs === undefined ? undefined : `${String(Math.round(cell.durationMs))} ms`,
  ].filter((fact) => fact !== undefined && fact !== "");
  return `<header>${escapeHtml(facts.join(" · "))}</header>`;
}

function cellHtml(cell: NotebookHtmlCell, options: NotebookHtmlOptions): string {
  const id = escapeHtml(cell.id);
  if (cell.type === "markdown")
    return `<section data-cell="${id}" data-type="markdown"><div class="jsnb-md">${options.markdown(cell.source)}</div></section>`;
  const source = `<pre class="jsnb-src"><code>${escapeHtml(cell.source)}</code></pre>`;
  return `<section data-cell="${id}" data-type="${cell.type}">${headerOf(cell)}${source}${outputsHtml(cell, options)}</section>`;
}

/** The notebook as one HTML page: both themes, no script, no network but https images. */
export function notebookToHTML(
  cells: readonly NotebookHtmlCell[],
  options: NotebookHtmlOptions,
): string {
  const theme = options.theme === undefined ? "" : ` data-theme="${options.theme}"`;
  const title = escapeHtml(options.title);
  const style = [exportStyle(), ...notebookRules].join("\n");
  const body = cells.map((cell) => cellHtml(cell, options)).join("\n");
  return `<!doctype html>\n<html lang="en"${theme}><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${style}</style></head><body><main class="jsnb-ov jsnb-nb"><h1 class="jsnb-title">${title}</h1>\n${body}\n</main></body></html>\n`;
}
