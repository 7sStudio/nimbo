// Selection: which cells `notebook.run` runs.
import { z } from "zod";

import { CellId } from "./ids.js";

export const Selection = z.union([
  z.literal("all"),
  z.object({ cells: z.array(CellId).readonly() }).readonly(),
  z.object({ above: CellId }).readonly(),
  z.object({ withDependents: CellId }).readonly(),
  z.object({ stale: z.literal(true) }).readonly(),
]);
export type Selection = z.infer<typeof Selection>;
