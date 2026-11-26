// What the copy and export menus offer: "copy as" JSON, JavaScript literal and CSV for a value
// (the text of any other output), and each export format of the output plus the grid's selection as a list.
import type { Path } from "@jsnb/core";

import { toCSV } from "../model/csv.js";
import { displayJson } from "../model/detect.js";
import type { ExportFormat } from "../model/export.js";
import { exportFormats } from "../model/export.js";
import { toLiteral } from "../model/literal.js";
import type { ViewInput } from "../model/output.js";
import { fullValueJson } from "../model/output.js";
import { valueText } from "./clipboard.js";
import type { CopyEvent } from "./options.js";

export type CopyItem = {
  readonly label: string;
  readonly what: CopyEvent["what"];
  readonly text: () => string;
};

/** The value an output's copy works on (a value, a JSON display, an event's data), else undefined. */
export function valueJson(input: ViewInput): { readonly json: unknown } | undefined {
  if (input.kind === "value") return { json: input.json };
  return input.kind === "event" ? { json: input.data } : displayJson(input);
}

/** The "copy as" items: JSON, JavaScript literal and CSV (for records) of a value, else its text; `root` resolves the
 * value's refs when it is a node of a larger one (full screen). */
export function copyItems(input: ViewInput, text: () => string, root?: unknown): CopyItem[] {
  const value = valueJson(input);
  if (value === undefined) return [{ label: "Copy text", what: "value", text }];
  const from = root ?? value.json;
  const csv = toCSV(value.json, from);
  return [
    { label: "Copy as JSON", what: "json", text: () => valueText(value.json, from) },
    { label: "Copy as JavaScript", what: "js", text: () => toLiteral(value.json, from) },
    ...(csv === undefined ? [] : [{ label: "Copy as CSV", what: "csv" as const, text: () => csv }]),
  ];
}

const formatLabels: Readonly<Record<ExportFormat, string>> = {
  json: "JSON",
  ndjson: "NDJSON",
  csv: "CSV",
  text: "Text",
  html: "HTML page",
  js: "JavaScript",
};

export type ExportItem =
  | { readonly kind: "format"; readonly label: string; readonly format: ExportFormat }
  | {
      readonly kind: "selection";
      readonly label: string;
      readonly format: "json" | "ndjson";
      readonly paths: readonly Path[];
    };

/** What an export covers: the whole value, the full value fetched for a cut one, or only the slice the page has. */
export type ExportScope = "whole" | "full" | "slice";

/** The export items: each format the output offers (marked when only the loaded slice can go out), and the selected
 * rows as JSON or NDJSON. */
export function exportItems(
  input: ViewInput,
  selection: readonly number[],
  scope: ExportScope,
): ExportItem[] {
  const paths = selection.map((index) => [index]);
  const note = scope === "slice" ? " (loaded slice only)" : "";
  return [
    ...exportFormats(input).map((format) => ({
      kind: "format" as const,
      label: `${formatLabels[format]}${note}`,
      format,
    })),
    ...(paths.length === 0
      ? []
      : (["json", "ndjson"] as const).map((format) => ({
          kind: "selection" as const,
          label: `Selection as ${formatLabels[format]}`,
          format,
          paths,
        }))),
  ];
}

/** A cut value output as its full value: the wire-form `json` the daemon streams, read
 * as an uncut value's, so every format exports what the same value uncut exports. */
export async function fullInput(input: ViewInput, blob: Blob): Promise<ViewInput> {
  if (input.kind !== "value") return input;
  const json = fullValueJson(await blob.text());
  return { ...input, json, truncated: false };
}
