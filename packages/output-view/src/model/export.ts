// Export and "copy as": JSON, NDJSON, CSV for grids, text for streams, the self-contained HTML
// page and the JavaScript literal, each offered for the outputs it makes sense for.
import type { Path } from "@jsnb/core";

import { stripAnsi } from "./ansi.js";
import { jsonText, toCSV } from "./csv.js";
import { displayJson } from "./detect.js";
import type { HtmlOptions } from "./html.js";
import { toHTML } from "./html.js";
import { toLiteral } from "./literal.js";
import type { ViewInput } from "./output.js";
import { toPlain } from "./plain.js";
import { gridOf } from "./records.js";
import { resolve } from "./wire.js";

export type ExportFormat = "json" | "ndjson" | "csv" | "text" | "html" | "js";

export type Exported = {
  readonly format: ExportFormat;
  readonly mime: string;
  readonly extension: string;
  readonly text: string;
};

export type ExportOutcome =
  | { readonly ok: true; readonly value: Exported }
  | { readonly ok: false; readonly error: { readonly message: string } };

/** `root`: the output's value a node's refs resolve against when the node is not the whole value (full screen). */
export type ExportOptions = HtmlOptions & { readonly root?: unknown };

const files: Readonly<Record<ExportFormat, { readonly mime: string; readonly extension: string }>> =
  {
    json: { mime: "application/json", extension: "json" },
    ndjson: { mime: "application/x-ndjson", extension: "ndjson" },
    csv: { mime: "text/csv", extension: "csv" },
    text: { mime: "text/plain", extension: "txt" },
    html: { mime: "text/html", extension: "html" },
    js: { mime: "text/javascript", extension: "js" },
  };

/** The wire form an output carries as a value: a value's json, a `display.json()` payload, an event's data. */
function valueOf(input: ViewInput): { readonly json: unknown } | undefined {
  if (input.kind === "value" || input.kind === "event")
    return { json: input.kind === "value" ? input.json : input.data };
  return displayJson(input);
}

/** The formats an output offers in its export menu, the first being the default. */
export function exportFormats(input: ViewInput): readonly ExportFormat[] {
  const value = valueOf(input);
  if (input.kind === "error") return ["json", "text", "html"];
  if (value === undefined) return ["text", "html"];
  const csv: ExportFormat[] = gridOf(value.json) ? ["csv"] : [];
  return input.kind === "event"
    ? ["json", "js", "text", "html"]
    : ["json", "ndjson", ...csv, "js", "text", "html"];
}

const pretty = (plain: unknown): string => `${JSON.stringify(plain ?? null, null, 2)}\n`;

/** A value's plain JSON, pretty-printed: "copy value as JSON" (⌘C) and the JSON export; `root` resolves refs. */
export const toJSON = (json: unknown, root: unknown = json): string => pretty(toPlain(json, root));

/** NDJSON: one compact JSON value per array item, or one line for anything else; `root` resolves refs. */
export function toNDJSON(json: unknown, root: unknown = json): string {
  const plain = toPlain(json, root);
  const lines = Array.isArray(plain) ? plain : [plain];
  return lines.map((line) => `${jsonText(line ?? null)}\n`).join("");
}

/** An output as plain text: a stream without its escapes, a value's repr, an error's raw stack, a DOM's text. */
export function toText(input: ViewInput): string {
  switch (input.kind) {
    case "value":
      return `${input.repr}\n`;
    case "stream":
      return stripAnsi(input.text);
    case "error":
      return `${input.error.raw}\n`;
    case "display":
      return input.data;
    case "dom":
      return input.text;
    case "event":
      return `${input.name} ${input.at}\n${pretty(toPlain(input.data))}`;
  }
}

function render(
  input: ViewInput,
  format: ExportFormat,
  options: ExportOptions,
): string | undefined {
  const value = valueOf(input);
  if (format === "text") return toText(input);
  if (format === "html") return toHTML(input, options);
  if (input.kind === "error") return format === "json" ? pretty(input.error) : undefined;
  if (value === undefined) return undefined;
  const root = options.root ?? value.json;
  if (format === "json") return toJSON(value.json, root);
  if (format === "ndjson") return toNDJSON(value.json, root);
  return format === "csv" ? toCSV(value.json, root) : `${toLiteral(value.json, root)}\n`;
}

/** An output in one format; a format the output does not offer is a failure that says which ones it does. */
export function exportAs(
  input: ViewInput,
  format: ExportFormat,
  options: ExportOptions = {},
): ExportOutcome {
  const offered = exportFormats(input);
  const text = offered.includes(format) ? render(input, format, options) : undefined;
  if (text === undefined) {
    const message = `${format.toUpperCase()} is not available for this ${input.kind} output; it offers ${offered.join(", ")}.`;
    return { ok: false, error: { message } };
  }
  return { ok: true, value: { format, ...files[format], text } };
}

/** "Copy or export the selection as a list": the nodes at `paths` in `json` as a JSON array or
 * NDJSON; `root` resolves refs. */
export function exportSelection(
  json: unknown,
  paths: readonly Path[],
  format: "json" | "ndjson",
  root: unknown = json,
): Exported {
  const nodes = paths.map((path) => toPlain(resolve(json, path)?.node, root) ?? null);
  const text =
    format === "json" ? pretty(nodes) : nodes.map((node) => `${jsonText(node)}\n`).join("");
  return { format, ...files[format], text };
}
