// The workspace .env of 07-file-format §8: KEY=value lines with an optional `export `, single or double quotes
// (double quotes unescape \" \\ and \n, as secrets.set writes them), # comment lines, blank lines, CRLF tolerated,
// no expansion; and which names the client realm may see (04-kernel §8).

/** The most a .env may hold (04-kernel §2, §10): no dotenv file is that large, and it is read before every run. */
export const maxEnvBytes = 1024 * 1024;

// dotAll: a value may hold a carriage return or a line separator (only \n ends a line).
const assignment = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*?)\s*$/s;
const skipped = /^\s*(?:#.*)?$/;

/** The text between double quotes with `\"`, `\\` and `\n` unescaped, or undefined when no quote closes it. */
function doubleQuoted(raw: string): string | undefined {
  let out = "";
  for (let index = 1; index < raw.length; index += 1) {
    const char = raw.charAt(index);
    if (char === '"') return out;
    if (char !== "\\" || index + 1 === raw.length) {
      out += char;
      continue;
    }
    const next = raw.charAt(index + 1);
    out += next === "n" ? "\n" : next === '"' || next === "\\" ? next : `\\${next}`;
    index += 1;
  }
  return undefined;
}

/** A value as written after `=`: quoted forms lose their quotes, an unquoted value is kept as is. */
function valueOf(raw: string): string {
  if (raw.startsWith('"')) return doubleQuoted(raw) ?? raw;
  if (raw.startsWith("'")) {
    const end = raw.indexOf("'", 1);
    return end === -1 ? raw : raw.slice(1, end);
  }
  return raw;
}

/** The variables of a `.env` text; a line that is not an assignment is skipped; a later line wins. */
export function parseDotenv(text: string): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const content = line.endsWith("\r") ? line.slice(0, -1) : line;
    const match = skipped.test(content) ? null : assignment.exec(content);
    if (match?.[1] !== undefined) values[match[1]] = valueOf(match[2] ?? "");
  }
  return values;
}

/** True for the names a client cell may read: `PUBLIC_*` and `*_PUBLISHABLE_KEY` (04-kernel §8, 05-bridge §2). */
export function isPublicEnvName(name: string): boolean {
  return name.startsWith("PUBLIC_") || name.endsWith("_PUBLISHABLE_KEY");
}

/** The values of the non-public names: what redaction masks (04-kernel §10). */
export function secretValues(values: Readonly<Record<string, string>>): readonly string[] {
  return Object.entries(values).flatMap(([name, value]) => (isPublicEnvName(name) ? [] : [value]));
}
