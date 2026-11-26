// The summary line every output shows (always visible), in words: what the result is called, then its kind,
// count and size, `Balance, object, 6 keys, 1.2 KB`, `Output, 5 lines`. No pill and no dot between the words.
import { displayJson, tableMime } from "./detect.js";
import { bytesLength } from "./leaf.js";
import type { ViewInput } from "./output.js";
import { countLabel, plural, thousands } from "./preview.js";
import { gridOf } from "./records.js";
import { streamLines } from "./ansi.js";
import type { WireKind } from "./wire.js";
import { kindOf, textField } from "./wire.js";

/** `name`: what the output is called (an instance's class, Object, Array, a value's type, a function's name, a stream
 * in the Console's words, Output for stdout and Error output for stderr, an error's name, a display's MIME type, Page for a client cell's elements, an event's name); `parts`: the rest in
 * words, its kind, count and size, which summaryText joins with commas. */
export type Summary = {
  readonly name: string;
  readonly parts: readonly string[];
  readonly truncated: boolean;
};

const count = thousands;

/** When an error was raised, after its name: the run's own, or a callback's during or after the run. */
const errorWhen = {
  run: "ended the run",
  during: "during the run",
  after: "after the run",
} as const;

/** `312 B`, `2.4 KB`, `4.1 MB` (1 KB = 1024 B). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${count(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit] ?? "GB"}`;
}

/** The UTF-8 size of a value's JSON text. */
export const jsonBytes = (json: unknown): number =>
  new TextEncoder().encode(JSON.stringify(json)).length;

const leafNames: Readonly<Record<string, string>> = {
  special: "number",
  date: "Date",
  regexp: "RegExp",
  ref: "reference",
};

/** The names of a primitive's summary, which a toolbar can leave unsaid. */
export const primitiveNames: ReadonlySet<string> = new Set([
  "number",
  "boolean",
  "null",
  "undefined",
  "bigint",
  "symbol",
]);

type Named = { readonly name: string; readonly parts: readonly string[] };

/** A leaf: `string, 58 characters`, `bytes, 16 B`, `TypeError`, `createIntent, function`, `number`, `Date`. */
function leafSummary(json: unknown, kind: WireKind): Named {
  if (typeof json === "string")
    return { name: "string", parts: [plural(json.length, "character", "characters")] };
  if (kind === "bytes") return { name: "bytes", parts: [formatBytes(bytesLength(json))] };
  if (kind === "error") return { name: textField(json, "name") ?? "Error", parts: [] };
  if (kind === "function") {
    const name = textField(json, "name") ?? "";
    return name === "" ? { name: "function", parts: [] } : { name, parts: ["function"] };
  }
  return { name: leafNames[kind] ?? kind, parts: [] };
}

const containerNames: Readonly<Partial<Record<WireKind, string>>> = {
  array: "Array",
  map: "Map",
  set: "Set",
  object: "Object",
};

/** A container: its name, then for an instance the word object, then its count (a grid's rows and columns) and size. */
function containerSummary(json: unknown, kind: WireKind, name: string): Named {
  const grid = gridOf(json);
  const counted = grid
    ? [plural(grid.rows.length, "row", "rows"), plural(grid.columns.length, "column", "columns")]
    : [countLabel(json, kind) ?? ""].filter((part) => part !== "");
  const size = formatBytes(jsonBytes(json));
  return { name, parts: [...(kind === "instance" ? ["object"] : []), ...counted, size] };
}

/** What a value is called and what it is. */
function valueSummary(json: unknown): Named {
  const kind = kindOf(json);
  if (kind === "instance")
    return containerSummary(json, kind, textField(json, "$class") ?? "Object");
  const container = containerNames[kind];
  return container === undefined
    ? leafSummary(json, kind)
    : containerSummary(json, kind, container);
}

/** A display: "Table" (display.table) and "Image" (display.image) by their kind, others by their mime. */
function displayNamed(input: ViewInput & { readonly kind: "display" }): Named {
  const parsed = displayJson(input);
  if (parsed === undefined)
    return input.mime.startsWith("image/")
      ? { name: "Image", parts: [input.mime.slice("image/".length)] }
      : { name: input.mime, parts: [] };
  const value = valueSummary(parsed.json);
  if (input.mime === tableMime) return { name: "Table", parts: value.parts };
  return { name: input.mime, parts: [value.name, ...value.parts] };
}

function named(input: ViewInput): Named {
  switch (input.kind) {
    case "value":
      return valueSummary(input.json);
    case "stream":
      return {
        name: input.stream === "stderr" ? "Error output" : "Output",
        parts: [plural(streamLines(input.text).length, "line", "lines")],
      };
    case "error":
      return {
        name: input.error.name,
        parts: input.when === undefined ? [] : [errorWhen[input.when]],
      };
    case "display":
      return displayNamed(input);
    case "dom":
      return {
        name: "Page",
        parts: [`${plural(input.text.length, "character", "characters")} of text`],
      };
    case "event":
      return { name: input.name, parts: [] };
  }
}

/** The summary of an output: what it is called, what it is in words, and whether it was cut. */
export function summarize(input: ViewInput): Summary {
  const truncated = input.kind === "value" && input.truncated === true;
  return { ...named(input), truncated };
}

/** The words after the name, `object, 6 keys, 1.2 KB, truncated`; "" when there are none. */
export const summaryParts = (summary: Summary): string =>
  [...summary.parts, ...(summary.truncated ? ["truncated"] : [])].join(", ");

/** The summary as one line, `Balance, object, 6 keys, 1.2 KB, truncated`. */
export const summaryText = (summary: Summary): string =>
  [summary.name, ...summary.parts, ...(summary.truncated ? ["truncated"] : [])].join(", ");
