// The four formats of `nimbo outputs` (03-api §8): pretty, the tree the page shows (output-view's model); json, the
// plain JSON of the value; ndjson, one line per item of an array (one line for anything else); csv, for tables only
// (outputsCsv.ts: SQL answers, non-empty arrays of records or of arrays of one length), any other value NotTabular.
import { toJSON, toNDJSON } from "@jsnb/output-view/model";

import { NotTabular } from "../errors/output.js";
import { table } from "../render/table.js";
import { treeLines } from "../render/tree.js";
import { sqlCsv, valueCsv } from "./outputsCsv.js";

export const formats = ["pretty", "json", "ndjson", "csv"] as const;
export type Format = (typeof formats)[number];

/** A wire-form value in a format; `cell` (and `query`, the mode of the query it answers) names it if it is no table. */
export function valueText(json: unknown, format: Format, cell: string, query?: string): string {
  if (format === "pretty") return `${treeLines(json).join("\n")}\n`;
  if (format === "json") return toJSON(json);
  if (format === "ndjson") return toNDJSON(json);
  const csv = valueCsv(json);
  if (csv === undefined)
    throw new NotTabular(query === undefined ? { cell, format } : { cell, format, query });
  return csv;
}

export type QueryOutput = {
  readonly mode: "filter" | "jsonpath" | "jq" | "sql";
  readonly result: {
    readonly paths?: readonly string[] | undefined;
    readonly value?: unknown;
    readonly columns?: readonly { readonly name: string; readonly type: string }[] | undefined;
    readonly rows?: readonly unknown[] | undefined;
  };
};

const cellText = (value: unknown): string =>
  typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value);

/** SQL's columns and rows as a table, its header the column names. */
function sqlTable(output: QueryOutput): string {
  const names = (output.result.columns ?? []).map((column) => column.name);
  const rows = (output.result.rows ?? []).map((row) =>
    names.map((name) =>
      cellText(typeof row === "object" && row !== null ? Reflect.get(row, name) : row),
    ),
  );
  return table(rows, names);
}

/** JSONPath and Filter, pretty: each selected path, then its node's tree under it. */
function selectionText(output: QueryOutput): string {
  const paths = output.result.paths ?? [];
  const nodes: readonly unknown[] = Array.isArray(output.result.value) ? output.result.value : [];
  return paths
    .map((path, index) => [path, ...treeLines(nodes[index]).map((line) => `  ${line}`)].join("\n"))
    .map((block) => `${block}\n`)
    .join("");
}

/** A query's answer in a format; SQL rows are plain JSON already, the other modes' values wire form. */
export function queryText(output: QueryOutput, format: Format, cell: string): string {
  const { mode, result } = output;
  if (mode === "sql") {
    if (format === "pretty") return sqlTable(output);
    const names = (result.columns ?? []).map((column) => column.name);
    if (format === "csv") return sqlCsv(names, result.rows ?? []);
    return valueText(result.rows ?? [], format, cell, mode);
  }
  if (format === "pretty")
    return mode === "jq" ? valueText(result.value, format, cell, mode) : selectionText(output);
  return valueText(result.value ?? [], format, cell, mode);
}
