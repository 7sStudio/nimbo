// DuckDB's error as a QueryError: its message without the `LINE n:` block, and the 0-based offset of the mistake
// in the SQL, so the query bar can underline it. DuckDB-WASM reports errors as JSON
// (`exception_type`, `exception_message`, `position`); node-api reports the plain text with the LINE block.
import type { Outcome } from "./errors.ts";
import { QueryError } from "./errors.ts";

const lineBlock = /LINE (\d+): (.*)\n( *)\^/u;
const lineBlocks = /\n*LINE \d+: .*\n *\^/gu;
const nodePrefix = /^Failed to extract statements: /u;

/** DuckDB's message without the `LINE n:` snippet and caret, and without node-api's statement-extraction prefix. */
export function cleanMessage(text: string): string {
  return text.replace(nodePrefix, "").replace(lineBlocks, "").trim();
}

/**
 * The caret's offset in `sql`: the column is the caret's column minus `"LINE n: ".length`; a snippet DuckDB
 * shortened (`...LECT {'m': …`) is found in line n of the SQL and the column counted from there.
 */
export function parsePosition(text: string, sql: string): Outcome<number, string> {
  const match = lineBlock.exec(text);
  if (match === null) return { ok: false, error: "no LINE block" };
  const [, number = "", snippet = "", spaces = ""] = match;
  const lines = sql.split("\n");
  const index = Number(number) - 1;
  const line = lines[index];
  if (line === undefined) return { ok: false, error: `no line ${number} in the SQL` };
  const lineStart = lines.slice(0, index).reduce((sum, previous) => sum + previous.length + 1, 0);
  const column = spaces.length - `LINE ${number}: `.length;
  if (!snippet.startsWith("...")) return { ok: true, value: lineStart + column };
  const shown = snippet.slice(3).replace(/\.\.\.$/u, "");
  const at = line.indexOf(shown);
  if (at < 0) return { ok: false, error: "the shortened snippet is not in the line" };
  return { ok: true, value: lineStart + at + column - 3 };
}

type Report = { readonly text: string; readonly position: number | undefined };

const field = (value: object, key: string): unknown => Reflect.get(value, key);

/** DuckDB-WASM's JSON error (`{"exception_type":"Parser","exception_message":…,"position":"14"}`) as plain text. */
export function readReport(message: string): Report {
  if (!message.startsWith("{")) return { text: message, position: undefined };
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    // Not JSON after all: the message is DuckDB's plain text.
    return { text: message, position: undefined };
  }
  if (typeof parsed !== "object" || parsed === null) return { text: message, position: undefined };
  const kind = field(parsed, "exception_type");
  const detail = field(parsed, "exception_message");
  if (typeof kind !== "string" || typeof detail !== "string")
    return { text: message, position: undefined };
  const position = Number(field(parsed, "position"));
  return {
    text: `${kind} Error: ${detail}`,
    position: Number.isSafeInteger(position) ? position : undefined,
  };
}

/**
 * A DuckDB failure of `sent` as QueryError("query"); `offset` is the length of what the engine put before the
 * user's SQL (COPY's prefix), so the position points into the SQL the user wrote.
 */
export function fromDuckDB(error: unknown, sent: string, offset = 0): QueryError {
  const report = readReport(error instanceof Error ? error.message : String(error));
  const parsed = parsePosition(report.text, sent);
  const absolute = report.position ?? (parsed.ok ? parsed.value : -1);
  const position = absolute - offset;
  return new QueryError("query", cleanMessage(report.text), {
    position: position >= 0 && position <= sent.length - offset ? position : undefined,
    cause: error,
  });
}
