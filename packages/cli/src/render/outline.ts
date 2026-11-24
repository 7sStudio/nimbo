// The human rendering of any command's output when none more specific exists (03-api §8): an indented outline,
// `key: value` per scalar, short lists of scalars on one line, lists of objects as `-` items, multi-line text as a block.
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isScalar = (value: unknown): boolean => value === null || typeof value !== "object";

const scalarText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
};

/**
 * A short list of words on one line; undefined for lines of text (kernel.log's), long lists and lists of objects, which
 * go one item per line, where `, ` stays unambiguous.
 */
function inlineList(items: readonly unknown[]): string | undefined {
  if (!items.every(isScalar)) return undefined;
  const words = items.map(scalarText);
  const line = words.join(", ");
  return line.length <= 100 && !words.some((word) => word.includes(",")) ? line : undefined;
}

/** The lines of `value` under `key`, at `indent`. */
function entryLines(key: string, value: unknown, indent: string): string[] {
  if (typeof value === "string" && value.includes("\n")) {
    return [`${indent}${key}: |`, ...value.split("\n").map((line) => `${indent}  ${line}`)];
  }
  if (isScalar(value)) return [`${indent}${key}: ${scalarText(value)}`];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}${key}: (none)`];
    const inline = inlineList(value);
    if (inline !== undefined) return [`${indent}${key}: ${inline}`];
    return [`${indent}${key}:`, ...value.flatMap((item) => itemLines(item, `${indent}  `))];
  }
  const nested = valueLines(value, `${indent}  `);
  return nested.length === 0 ? [`${indent}${key}: {}`] : [`${indent}${key}:`, ...nested];
}

/** One `-` item of a list: its first line after the dash, the rest under it. */
function itemLines(item: unknown, indent: string): string[] {
  if (isScalar(item)) return [`${indent}- ${scalarText(item)}`];
  const [first, ...rest] = valueLines(item, `${indent}  `);
  return first === undefined ? [`${indent}- {}`] : [`${indent}- ${first.trimStart()}`, ...rest];
}

function valueLines(value: unknown, indent: string): string[] {
  if (isRecord(value))
    return Object.entries(value).flatMap(([key, entry]) => entryLines(key, entry, indent));
  if (Array.isArray(value)) return value.flatMap((item) => itemLines(item, indent));
  return [`${indent}${scalarText(value)}`];
}

/** The outline of an output, newline-terminated; an empty object (`{}`) renders as nothing. */
export function outline(value: unknown): string {
  const lines = valueLines(value, "");
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
