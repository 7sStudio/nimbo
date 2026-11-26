// CellAnalysis: the static facts of one cell that transform's analyser produces and
// the graph, staleness and bridge consume.
import { z } from "zod";

import { BindingKind } from "./binding.js";

export const CellAnalysis = z
  .object({
    /** Names assigned on `__scope` at top level: declarations, imports and top-level writes to free names, in source order. */
    defines: z.array(z.string()).readonly(),
    /** Every free identifier read at any depth, `typeof x` and realm globals included. */
    uses: z.array(z.string()).readonly(),
    exports: z.array(z.string()).readonly(),
    /** Module specifiers of `import` statements and literal `import("…")`, in source order. */
    imports: z.array(z.string()).readonly(),
    /** The declaration kind per defined name; a top-level write to an undeclared name has none. */
    kinds: z.record(z.string(), BindingKind).readonly(),
  })
  .readonly();
export type CellAnalysis = z.infer<typeof CellAnalysis>;

/** What a markdown cell, or an empty one, analyses to. */
export function emptyAnalysis(): CellAnalysis {
  return { defines: [], uses: [], exports: [], imports: [], kinds: {} };
}
