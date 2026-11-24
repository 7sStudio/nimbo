// An open notebook's last result for notebook.summary (03-api §4.2): the run that ended last with an
// output worth showing, read from the session's runs (a notebook file holds no outputs, 07-file-format §3). Pure.
import type { Execution } from "../model/execution.js";
import type { LastResult } from "../model/summary.js";

const resultLines = 6;
const lineLimit = 200;

const cut = (text: string): string =>
  text.length > lineLimit ? `${text.slice(0, lineLimit - 1)}…` : text;

/** A few lines of a text, each cut. */
const linesOf = (text: string, from: "start" | "end"): readonly string[] => {
  const lines = text.replace(/\n+$/u, "").split("\n");
  const kept = from === "start" ? lines.slice(0, resultLines) : lines.slice(-resultLines);
  return kept.map((line) => cut(line.trimEnd()));
};

/** What one output says, for a last result; none for an event or an error, which are no result to show. */
function resultOf(output: Execution["outputs"][number]): Pick<LastResult, "kind" | "lines"> | null {
  switch (output.kind) {
    case "value":
      return { kind: "value", lines: linesOf(output.repr, "start") };
    case "dom":
      return { kind: "page", lines: [cut(output.text.replace(/\s+/gu, " ").trim())] };
    case "display":
      return { kind: "html", lines: [`${output.mime}, ${String(output.data.length)} characters`] };
    case "stream":
      return output.text.trim() === ""
        ? null
        : { kind: "text", lines: linesOf(output.text, "end") };
    default:
      return null;
  }
}

/**
 * The last result of `runs` (each cell's last run, in notebook order, null for a cell that never ran): the run that
 * ended last with status ok and an output worth showing, its last value, page or display output, else what it printed
 * last. Null when no run qualifies.
 */
export function lastResult(runs: readonly (Execution | null)[]): LastResult | null {
  let best: LastResult | null = null;
  for (const [at, run] of runs.entries()) {
    if (run?.status !== "ok" || run.endedAt === undefined) continue;
    if (best !== null && best.at >= run.endedAt) continue;
    const outputs = run.outputs.map(resultOf).filter((each) => each !== null);
    const shown = outputs.findLast((each) => each.kind !== "text") ?? outputs.at(-1);
    if (shown !== undefined) best = { cell: at + 1, at: run.endedAt, ...shown };
  }
  return best;
}
