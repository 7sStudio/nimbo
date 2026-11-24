// The transform's refusals as diagnostics (last paragraph): what TypeScript accepts but a
// cell may not hold (`export default`, a top-level enum, namespace or `using`, a reserved name), from the same
// analysis the session runs on every edit, at the error's place when it has one, else on the cell's first line.
import type { CellType, Diagnostic } from "@jsnb/core";
import { isJsnbError } from "@jsnb/core";
import { analyze } from "@jsnb/transform";

const refusals = new Set(["DefaultExport", "UnsupportedSyntax", "ReservedName"]);

/** A 1-based `{ line, col }` in the error's data, as a 0-based position. */
function placeOf(data: unknown): { line: number; character: number } {
  const record: Record<string, unknown> =
    typeof data === "object" && data !== null ? { ...data } : {};
  const line = typeof record.line === "number" ? record.line - 1 : 0;
  const col = typeof record.col === "number" ? record.col - 1 : 0;
  return { line: Math.max(0, line), character: Math.max(0, col) };
}

const memo = new Map<string, Diagnostic[]>();
const memoSize = 500;

/** The transform's refusal of a code cell's source, as one diagnostic, or none; each source analysed once (the
 * transform runs in the daemon's thread, so a recompute of a large notebook re-reads only the cells that changed). */
export function analysisDiagnostics(type: CellType, source: string): Diagnostic[] {
  if (type === "markdown") return [];
  const known = memo.get(source);
  if (known) return known;
  const found = refusalOf(source);
  if (memo.size >= memoSize) memo.delete(memo.keys().next().value ?? "");
  memo.set(source, found);
  return found;
}

function refusalOf(source: string): Diagnostic[] {
  try {
    analyze(source);
    return [];
  } catch (error) {
    if (!isJsnbError(error) || !refusals.has(error.name)) return [];
    const start = placeOf(error.data);
    const lineLength = source.split(/\r\n|\r|\n/u)[start.line]?.length ?? start.character;
    const end = { line: start.line, character: Math.max(start.character, lineLength) };
    return [
      {
        range: { start, end },
        severity: "error",
        code: error.name,
        message: error.message,
        source: "nimbo",
      },
    ];
  }
}
