// serialize: the deterministic .jsnb layout of 07-file-format §2, written by hand so source arrays are one line each.
import { cellMetaKeys } from "../model/cell.js";
import { toLines } from "./lines.js";
import type { DocumentCell, NotebookDocument } from "./schema.js";

const indentUnit = "  ";

/** `JSON.stringify(value, null, 2)` re-indented to sit at `depth`. */
function standard(value: unknown, depth: number): string {
  const text = JSON.stringify(value, null, 2);
  return text.split("\n").join(`\n${indentUnit.repeat(depth)}`);
}

/** `"key": value` pairs joined into an object literal at `depth`; `{}` when empty. */
function object(pairs: readonly (readonly [string, string])[], depth: number): string {
  if (pairs.length === 0) return "{}";
  const inner = indentUnit.repeat(depth + 1);
  const body = pairs.map(([key, value]) => `${inner}${JSON.stringify(key)}: ${value}`).join(",\n");
  return `{\n${body}\n${indentUnit.repeat(depth)}}`;
}

function lines(source: string, depth: number): string {
  const items = toLines(source);
  if (items.length === 0) return "[]";
  const inner = indentUnit.repeat(depth + 1);
  return `[\n${items.map((line) => `${inner}${JSON.stringify(line)}`).join(",\n")}\n${indentUnit.repeat(depth)}]`;
}

/** Known meta keys in the 07-file-format §2 order, then the unknown ones as they came. */
function meta(value: Readonly<Record<string, unknown>>, depth: number): string | undefined {
  const known = cellMetaKeys.filter((key) => value[key] !== undefined);
  const unknown = Object.keys(value).filter((key) => !cellMetaKeys.some((k) => k === key));
  const pairs = [...known, ...unknown].map(
    (key) => [key, standard(value[key], depth + 1)] as const,
  );
  return pairs.length === 0 ? undefined : object(pairs, depth);
}

function cell(value: DocumentCell, depth: number): string {
  const pairs: (readonly [string, string])[] = [
    ["id", JSON.stringify(value.id)],
    ["type", JSON.stringify(value.type)],
    ["source", lines(value.source, depth + 1)],
  ];
  const metaText = meta(value.meta, depth + 1);
  if (metaText !== undefined) pairs.push(["meta", metaText]);
  for (const [key, extra] of Object.entries(value.extra))
    pairs.push([key, standard(extra, depth + 1)]);
  return object(pairs, depth);
}

/** The saved runs in cell order, each in the standard layout; undefined when the document has no `outputs`. */
function savedRunPairs(doc: NotebookDocument): (readonly [string, string])[] | undefined {
  const { outputs } = doc;
  if (outputs === undefined) return undefined;
  return doc.cells.flatMap((c) => {
    const run = outputs[c.id];
    return run === undefined ? [] : [[c.id, standard(run, 2)] as const];
  });
}

/** The file text: two-space indent, LF, a trailing newline, keys in the documented order. */
export function serialize(doc: NotebookDocument): string {
  const pairs: (readonly [string, string])[] = [["version", JSON.stringify(doc.version)]];
  if (doc.jsnb !== undefined) pairs.push(["jsnb", JSON.stringify(doc.jsnb)]);
  const cells =
    doc.cells.length === 0
      ? "[]"
      : `[\n${doc.cells.map((c) => `${indentUnit.repeat(2)}${cell(c, 2)}`).join(",\n")}\n${indentUnit}]`;
  pairs.push(["cells", cells]);
  const runs = savedRunPairs(doc);
  if (runs !== undefined) pairs.push(["outputs", object(runs, 1)]);
  for (const [key, extra] of Object.entries(doc.extra)) pairs.push([key, standard(extra, 1)]);
  return `${object(pairs, 0)}\n`;
}
