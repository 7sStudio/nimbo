// A plain-text table: columns padded to their widest cell, two spaces apart, the last column left as it is.
/** The table's lines, newline-terminated; `header` first when given. */
export function table(rows: readonly (readonly string[])[], header?: readonly string[]): string {
  const all = header === undefined ? rows : [header, ...rows];
  if (all.length === 0) return "";
  const count = Math.max(...all.map((row) => row.length));
  const widths = Array.from({ length: count }, (_, column) =>
    Math.max(...all.map((row) => (row[column] ?? "").length)),
  );
  const line = (row: readonly string[]): string =>
    row
      .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)))
      .join("  ")
      .trimEnd();
  return `${all.map(line).join("\n")}\n`;
}

/** One line of a text: its first, cut to `width` characters with an ellipsis. */
export function firstLine(text: string, width: number): string {
  const first = text.split("\n")[0] ?? "";
  const more = text.includes("\n") ? " …" : "";
  return first.length > width ? `${first.slice(0, width - 1)}…` : `${first}${more}`;
}
