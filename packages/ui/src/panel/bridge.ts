// The inspector's Bridge group: each name a server cell exports, the cell that exports it, and the client cells whose
// source uses it, read from the notebook's graph (notebook.graph), with its parameters as the exporting cell's text
// writes them. A call's arguments and result are not the graph's to know: the Activity log's bridge rows hold the
// calls this page made.
import type { CellId } from "@jsnb/core";

import type { GraphEntry } from "../store/mirror.js";

export type BridgeExport = {
  readonly name: string;
  /** "async (amount, currency)" as the exporting cell's text declares it; "" when no plain pattern finds it. */
  readonly signature: string;
  readonly cell: { readonly id: CellId; readonly number: number };
  /** The 1-based numbers of the client cells that use the name. */
  readonly callers: readonly number[];
};

type Listed = { readonly id: CellId; readonly type: string; readonly source?: string };

const escape = (name: string) => name.replace(/[$]/gu, "\\$");

/** The parameters of `name` in `source`: `function name(…)`, `name = (…) =>`, `name = async function (…)`, each
 * with `async` when it has it; "" for a form the pattern does not read (an export of a value, a destructured one). */
function signatureOf(name: string, source: string): string {
  const id = escape(name);
  const declared = new RegExp(`(async\\s+)?function\\*?\\s+${id}\\s*\\(([^)]*)\\)`, "u").exec(
    source,
  );
  const assigned = new RegExp(
    `\\b${id}\\s*=\\s*(async\\s+)?(?:function\\s*\\*?\\s*\\w*\\s*)?\\(([^)]*)\\)`,
    "u",
  ).exec(source);
  const found = declared ?? assigned;
  if (found === null) return "";
  const params = (found[2] ?? "").replace(/\s+/gu, " ").trim();
  return `${found[1] === undefined ? "" : "async "}(${params})`;
}

/** The exports of the server cells in notebook order, each name once (the first cell that exports it wins, as the
 * bridge resolves it), with the client cells that use it. */
export function bridgeOf(
  cells: readonly Listed[],
  graph: ReadonlyMap<CellId, GraphEntry>,
): readonly BridgeExport[] {
  const found = new Map<string, BridgeExport>();
  cells.forEach((cell, at) => {
    if (cell.type !== "server") return;
    for (const name of graph.get(cell.id)?.exports ?? []) {
      if (found.has(name)) continue;
      const callers = cells.flatMap((each, index) =>
        each.type === "client" && (graph.get(each.id)?.uses.includes(name) ?? false)
          ? [index + 1]
          : [],
      );
      const signature = signatureOf(name, cell.source ?? "");
      found.set(name, { name, signature, cell: { id: cell.id, number: at + 1 }, callers });
    }
  });
  return [...found.values()];
}

/** `signature` without what names it: `function summarize(…): R`, `const summarize: (…) => R` and
 * `async function* summarize(…)` give their parameters on; any other form stays as it is. */
export function signatureTail(signature: string, name: string): string {
  const id = escape(name);
  const head = new RegExp(
    `^(?:\\((?:alias|function)\\)\\s+)?(?:(?:async|function\\*?|const|let|var)\\s+)*${id}(?:\\s*:\\s*)?`,
    "u",
  );
  return signature.replace(head, "");
}

/** A signature the hover lays out over lines (an object type's members, one per line) on one line, as the panel
 * wraps it: `{\n    a: string;\n}` is `{ a: string; }`. */
export const compactSignature = (signature: string): string =>
  signature.replace(/\s*\n\s*/gu, " ").trim();
