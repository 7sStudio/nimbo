// A value as static HTML for the export page: the tree as nested <details> open to `expandDepth`, a grid as a table,
// every token in its syntax color. Everything is escaped; nothing in the page runs.
import type { Path } from "@jsnb/core";

import { defaultExpandDepth } from "./expansion.js";
import type { Token } from "./leaf.js";
import { leafTokens } from "./leaf.js";
import { preview, countLabel, typeLabel } from "./preview.js";
import type { Grid } from "./records.js";
import { cellOf } from "./records.js";
import type { Child, RowKey } from "./wire.js";
import { childCount, children, isContainer, kindOf } from "./wire.js";

export type ValueHtmlOptions = {
  readonly expandDepth?: number;
  readonly timeZone?: string;
};

const entities: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Text safe inside an element or a double-quoted attribute. */
export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (ch) => entities[ch] ?? ch);

/** Tokens as spans carrying their syntax token name. */
const tokensHtml = (tokens: readonly Token[]): string =>
  tokens
    .map((token) => `<span data-token="${token.kind}">${escapeHtml(token.text)}</span>`)
    .join("");

function keyHtml(key: RowKey, options: ValueHtmlOptions): string {
  switch (key.kind) {
    case "name":
      return tokensHtml([
        { kind: "key", text: key.name },
        { kind: "punc", text: ": " },
      ]);
    case "index":
      return tokensHtml([
        { kind: "nul", text: String(key.index) },
        { kind: "punc", text: ": " },
      ]);
    case "entry":
      return `${tokensHtml(preview(key.node, { width: 40, ...options }))}${tokensHtml([{ kind: "punc", text: " => " }])}`;
    default:
      return "";
  }
}

type At = { readonly key: RowKey; readonly path: Path; readonly depth: number };

function nodeHtml(node: unknown, at: At, options: ValueHtmlOptions): string {
  const kind = kindOf(node);
  const key = keyHtml(at.key, options);
  const leafOptions =
    options.timeZone === undefined ? { at: at.path } : { at: at.path, timeZone: options.timeZone };
  if (!isContainer(kind) || childCount(node, kind) === 0) {
    return `<div data-part="row">${key}${tokensHtml(isContainer(kind) ? preview(node) : leafTokens(node, kind, leafOptions))}</div>`;
  }
  const label = typeLabel(node, kind) ?? "";
  const count = countLabel(node, kind) ?? "";
  const open = at.depth < (options.expandDepth ?? defaultExpandDepth) ? " open" : "";
  const inner = children(node, kind)
    .map((child: Child) =>
      nodeHtml(
        child.node,
        { key: child.key, path: [...at.path, ...child.segments], depth: at.depth + 1 },
        options,
      ),
    )
    .join("");
  return `<details${open}><summary>${key}${tokensHtml([{ kind: "typ", text: label }])}<span data-part="count">${escapeHtml(count)}</span></summary><div data-part="children">${inner}</div></details>`;
}

/** A value as a tree of nested <details>, open to `expandDepth` (default 2), every node present. */
export function treeHtml(json: unknown, options: ValueHtmlOptions = {}): string {
  return `<div data-part="value">${nodeHtml(json, { key: { kind: "root" }, path: [], depth: 0 }, options)}</div>`;
}

/** A grid as a table: an index column, then one column per record key (or matrix index). */
export function gridHtml(grid: Grid, options: ValueHtmlOptions = {}): string {
  const head = `<tr><th>#</th>${grid.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>`;
  const rows = grid.rows.map((row) => {
    const cells = grid.columns.map((column) => {
      const cell = cellOf(row, column);
      return `<td>${cell.present ? tokensHtml(preview(cell.node, { width: 60, ...options })) : ""}</td>`;
    });
    return `<tr><td data-token="nul">${String(row.index)}</td>${cells.join("")}</tr>`;
  });
  return `<table data-part="value"><thead>${head}</thead><tbody>${rows.join("")}</tbody></table>`;
}
