// `--format pretty`: a value as the tree the page shows, drawn from output-view's model layer
// (flatten, labels, leaf tokens) fully expanded, one row per line, indented by depth.
import type { NodeRow, Row, RowKey, Token } from "@jsnb/output-view/model";
import {
  countLabel,
  expandAll,
  flatten,
  leafTokens,
  preview,
  typeLabel,
} from "@jsnb/output-view/model";

const text = (tokens: readonly Token[]): string => tokens.map((token) => token.text).join("");

/** `name: `, `3: `, `"a" => `, or nothing for a Set member and the root. */
function keyText(key: RowKey): string {
  if (key.kind === "name") return `${key.name}: `;
  if (key.kind === "index") return `${String(key.index)}: `;
  if (key.kind === "entry") return `${text(preview(key.node, { width: 40 }))} => `;
  return "";
}

/** An open container `Array(2) [`, `{`; a closed one with its count; an empty one `{}`; a leaf as the tree shows it. */
function valueText(row: NodeRow): string {
  const label = typeLabel(row.value, row.kind) ?? "";
  if (row.hasChildren && row.expanded) {
    const named = row.kind === "object" ? "" : `${label} `;
    return `${named}${row.kind === "array" ? "[" : "{"}`;
  }
  if (row.hasChildren) return `${label} (${countLabel(row.value, row.kind) ?? ""})`;
  return text(
    row.count === 0 && label !== ""
      ? preview(row.value)
      : leafTokens(row.value, row.kind, { at: row.path }),
  );
}

function rowText(row: Row): string {
  const indent = "  ".repeat(row.depth);
  if (row.role === "close") return `${indent}${row.kind === "array" ? "]" : "}"}`;
  if (row.role === "hidden") return `${indent}… ${String(row.count)} hidden`;
  return `${indent}${keyText(row.key)}${valueText(row)}`;
}

/** The lines of a wire-form value's tree, every node open. */
export function treeLines(json: unknown): string[] {
  return flatten(json, { expansion: expandAll() }).map(rowText);
}
