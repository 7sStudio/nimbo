// A cell's analysis for the graph: transform's `analyze` for code cells; nothing for markdown
// and for a cell that does not parse yet (its run reports the syntax error).
import type { CellAnalysis, CellType } from "@jsnb/core";
import { emptyAnalysis, isJsnbError } from "@jsnb/core";
import { analyze } from "@jsnb/transform";

/** The analysis of `source` as a `type` cell. */
export function analysisOf(type: CellType, source: string): CellAnalysis {
  if (type === "markdown") return emptyAnalysis();
  try {
    return analyze(source);
  } catch (error) {
    // A cell the user is still typing does not parse; it defines and uses nothing until it does.
    if (isJsnbError(error)) return emptyAnalysis();
    throw error;
  }
}
