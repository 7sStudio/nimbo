// Source text as the file stores it: one array element per line, split and joined on "\n".

/** `""` is the empty cell `[]`; otherwise one element per line. A `\r` stays inside its line.
 * `[""]` (one empty line) and `[]` both load as `""`, so both write back as `[]`. */
export function toLines(source: string): string[] {
  return source === "" ? [] : source.split("\n");
}

/** The inverse of toLines. */
export function fromLines(lines: readonly string[]): string {
  return lines.join("\n");
}
