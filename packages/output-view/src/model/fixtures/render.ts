// The expectations of one corpus case as readable text: the view, the summary, the flattened rows,
// the grid, every hint and the exports, written to src/model/fixtures/corpus/<name>.txt as the golden file.
import { detect, viewsFor } from "../detect.js";
import { expandAll } from "../expansion.js";
import { exportAs, exportFormats } from "../export.js";
import type { Hint, HintContext } from "../hints.js";
import { hintsFor } from "../hints.js";
import { leafTokens } from "../leaf.js";
import type { Token } from "../leaf.js";
import type { ViewInput } from "../output.js";
import { countLabel, preview, typeLabel } from "../preview.js";
import { cellOf, gridOf } from "../records.js";
import { summarize, summaryText } from "../summary.js";
import type { Row } from "../tree.js";
import { flatten } from "../tree.js";
import type { RowKey } from "../wire.js";
import { isContainer } from "../wire.js";
import type { ValueCase } from "./values.js";

/** A fixed clock and zone, so dates and "3 min ago" read the same on every machine. */
const goldenContext: HintContext = {
  now: () => Date.parse("2026-10-12T09:00:00.000Z"),
  timeZone: "Europe/Paris",
};

const zone = { timeZone: "Europe/Paris" } as const;
const text = (tokens: readonly Token[]): string => tokens.map((token) => token.text).join("");

function keyText(key: RowKey): string {
  if (key.kind === "name") return `${key.name}: `;
  if (key.kind === "index") return `${String(key.index)}: `;
  return key.kind === "entry" ? `${text(preview(key.node, zone))} => ` : "";
}

const closing = (kind: string): string => (kind === "array" ? "]" : "}");

function nodeText(row: Row & { readonly role: "node" }): string {
  if (!isContainer(row.kind) || !row.hasChildren) {
    const tokens = isContainer(row.kind)
      ? preview(row.value, zone)
      : leafTokens(row.value, row.kind, { ...zone, at: row.path });
    return `${keyText(row.key)}${text(tokens)}`;
  }
  const count = row.expanded ? "" : ` · ${countLabel(row.value, row.kind) ?? ""}`;
  return `${keyText(row.key)}${typeLabel(row.value, row.kind) ?? ""}${count}`;
}

function rowText(row: Row): string {
  const indent = "  ".repeat(row.depth);
  if (row.role === "close") return `${indent}  ${closing(row.kind)}`;
  if (row.role === "hidden") return `${indent}  … ${String(row.count)} hidden`;
  const marker = row.hasChildren ? (row.expanded ? "▾ " : "▸ ") : "  ";
  return `${indent}${marker}${nodeText(row)}`;
}

function hintText(hint: Hint): string {
  switch (hint.kind) {
    case "time":
      return `time (${hint.source}) ${hint.absolute} · ${hint.relative}`;
    case "link":
      return `link ${hint.href}`;
    case "fold":
      return `fold ${String(hint.length)} chars, ${String(hint.shown)} shown`;
    default:
      return hint.kind;
  }
}

function gridText(json: unknown): string[] {
  const grid = gridOf(json);
  if (grid === undefined) return [];
  const header = grid.columns.map((column) => column.label).join(" | ");
  const rows = grid.rows.map((row) => {
    const cells = grid.columns.map((column) => {
      const cell = cellOf(row, column);
      return cell.present ? text(preview(cell.node, { ...zone, width: 40 })) : "∅";
    });
    return `  ${String(row.index)}: ${cells.join(" | ")}`;
  });
  return [`grid (${grid.shape}, ${String(grid.omitted)} omitted): ${header}`, ...rows];
}

function hintLines(json: unknown): string[] {
  return flatten(json, { expansion: expandAll() }).flatMap((row) =>
    row.role === "node"
      ? hintsFor(row.value, goldenContext, row.path).map((hint) => `  ${row.id}: ${hintText(hint)}`)
      : [],
  );
}

function exportLines(input: ViewInput): string[] {
  const formats = exportFormats(input);
  const shown = formats.filter((format) => format !== "html" && format !== "text");
  return [
    `exports: ${formats.join(", ")}`,
    ...shown.flatMap((format) => {
      const exported = exportAs(input, format, zone);
      return [
        `--- ${format}`,
        exported.ok ? exported.value.text.trimEnd() : `failed: ${exported.error.message}`,
      ];
    }),
  ];
}

/** The golden text of a case. */
export function renderCase(c: ValueCase): string {
  const input: ViewInput = { kind: "value", json: c.json, repr: c.repr, truncated: c.truncated };
  const summary = summarize(input);
  return [
    `view: ${detect(input)} (switch: ${viewsFor(input).join(", ") || "none"})`,
    `summary: ${summaryText(summary)}`,
    "rows:",
    ...flatten(c.json).map(rowText),
    ...gridText(c.json),
    "hints:",
    ...hintLines(c.json),
    ...exportLines(input),
    "",
  ].join("\n");
}
