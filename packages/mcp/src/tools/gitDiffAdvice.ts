// What a ResultTooLarge message tells the agent after git_diff: a notebook's diff one changed
// cell at a time with `cell`, the changed cells named; a text file's whole diff through `nimbo diff`.
import { jsnb } from "../errors/words.js";
import type { Exchange } from "./adviceParts.js";
import { call, isRecord, textOf } from "./adviceParts.js";

/** The ids of a notebook diff's changed cells, in the new order. */
function changedCells(output: Exchange["output"]): readonly string[] {
  const notebook = output.notebook;
  if (!isRecord(notebook) || !Array.isArray(notebook.rows)) return [];
  return notebook.rows.flatMap((row: unknown) => {
    if (!isRecord(row) || row.status === "unchanged") return [];
    const side = isRecord(row.after) ? row.after : isRecord(row.before) ? row.before : undefined;
    const id = textOf(side?.id);
    return id === undefined ? [] : [id];
  });
}

export function gitDiffAdvice({ input, output }: Exchange): string {
  const path = textOf(input.path) ?? "<path>";
  const base = textOf(input.base);
  const against = {
    ...(input.staged === true ? { staged: true } : {}),
    ...(base === undefined ? {} : { base }),
  };
  const cells = changedCells(output);
  const [first] = cells;
  const whole = `outside MCP, ${jsnb("diff", path, ...(input.staged === true ? ["--staged"] : []), ...(base === undefined ? [] : ["--base", base]))} prints the whole diff.`;
  if (first === undefined) return `Ask for less with narrower arguments; ${whole}`;
  const shown =
    cells.length > 20
      ? `${cells.slice(0, 20).join(", ")} and ${String(cells.length - 20)} more`
      : cells.join(", ");
  return `Read the diff one changed cell at a time with ${call("git_diff", { path, ...against, cell: first })}; the changed cells are ${shown}. Or, ${whole}`;
}
