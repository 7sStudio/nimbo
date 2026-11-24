// What a folded cell's name column says is inside it: Fold All folds every cell to its header
// row, and the notebook then reads as a list. Only what the page already knows of the cell: how many lines it holds,
// what it serves, exports or calls (cells/names.ts), what its last run returned and printed, who edited it last (the
// lines an agent changed while no one reviewed them) and
// whether its result is pinned; a markdown cell says how much prose is under its heading.
import type { CellMeta, Output } from "@jsnb/core";

import { changedBy, overOf, pendingEdit } from "./agentEdit.js";

const plural = (count: number, word: string, many = `${word}s`) =>
  `${String(count)} ${count === 1 ? word : many}`;

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;

/** Keys of a serialized object that are its own fields, not the wire form's markers. */
const ownKeys = (value: object): number =>
  Object.keys(value).filter((key) => key !== "$class" && key !== "$type").length;

const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

/** A marked value of the wire form (core's serialize/form.ts) in words: "a Map of 3", "a date". */
function marked(type: string, json: object): string {
  const entries = field(json, "entries");
  const values = field(json, "values");
  const length = field(json, "length");
  const named: Readonly<Record<string, string>> = {
    map: `a Map of ${String(Array.isArray(entries) ? entries.length : 0)}`,
    set: `a Set of ${String(Array.isArray(values) ? values.length : 0)}`,
    date: "a date",
    regexp: "a regular expression",
    error: "an error",
    function: "a function",
    bytes: `${String(typeof length === "number" ? length : 0)} bytes`,
    number: textOf(field(json, "value")),
    bigint: textOf(field(json, "value")),
  };
  return named[type] ?? "a value";
}

/** A value's shape in a few words: "Balance with 6 keys", "an array of 3", "42"; null for nothing to say (undefined,
 * which is what a cell that ends on a declaration returns). */
export function shapeOf(json: unknown): string | null {
  if (json === null) return "null";
  if (typeof json === "string") return plural(json.length, "character");
  if (typeof json === "number" || typeof json === "boolean") return String(json);
  if (typeof json !== "object") return null;
  if (Array.isArray(json)) return `an array of ${String(json.length)}`;
  const type = field(json, "$type");
  if (type === "undefined") return null;
  if (typeof type === "string") return marked(type, json);
  const name = field(json, "$class");
  const keys = plural(ownKeys(json), "key");
  return typeof name === "string" ? `${name} with ${keys}` : `an object with ${keys}`;
}

/** What the last run left: the value it returned, the page it drew or the lines it printed. */
function resultOf(outputs: readonly Output[], live: boolean): string | null {
  const value = outputs.find((output) => output.kind === "value");
  if (value !== undefined) {
    const shape = shapeOf(value.json);
    if (shape !== null) return `returns ${shape}`;
  }
  if (outputs.some((output) => output.kind === "dom"))
    return live ? "a page with its live elements" : "a page";
  const printed = outputs
    .flatMap((output) => (output.kind === "stream" ? output.text.split("\n") : []))
    .filter((line) => line !== "").length;
  return printed > 0 ? `printed ${plural(printed, "line")}` : null;
}

export type Inside = {
  readonly type: "server" | "client" | "markdown";
  readonly source: string;
  readonly meta: CellMeta;
  /** The few words the unfolded header says (cells/names.ts aboutOf): what it serves, exports or calls. */
  readonly about: string;
  /** Its listening routes' requests and the status of the last one, if any. */
  readonly requests: { readonly count: number; readonly last: number | null } | null;
  readonly outputs: readonly Output[];
  readonly live: boolean;
  readonly pinned: boolean;
};

/** "2 requests, the last one 200"; null for a cell that serves no route. */
function requestsOf(requests: Inside["requests"]): string | null {
  if (requests === null) return null;
  const last = requests.last === null ? "" : `, the last one ${String(requests.last)}`;
  return `${plural(requests.count, "request")}${last}`;
}

/** "edited by claude-code" for a cell an agent edited last and someone reviewed since. */
function editorOf(meta: CellMeta): string | null {
  const edit = meta.lastEdit;
  if (edit?.by !== "agent" || edit.review !== undefined) return null;
  return `edited by ${edit.agent ?? `an agent ${overOf(edit)}`}`;
}

/** "4 lines, lines 2 to 3 changed by claude-code, exported to client cells, returns Balance with 6 keys". */
export function insideOf(cell: Inside): string {
  const lines = plural(cell.source.split("\n").length, "line");
  if (cell.type === "markdown") return `${lines} of prose`;
  const requests = requestsOf(cell.requests);
  const what = requests ?? (cell.about === "" ? null : cell.about);
  const pending = pendingEdit(cell.meta);
  // an edit to review comes first after the size: it is what the folded list is read for
  const parts = [
    lines,
    pending === null ? null : changedBy(pending),
    what,
    requests === null ? resultOf(cell.outputs, cell.live) : null,
    cell.pinned ? "pinned to the inspector" : null,
    editorOf(cell.meta),
  ];
  return parts.filter((part) => part !== null).join(", ");
}
